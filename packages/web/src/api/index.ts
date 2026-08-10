import type { RouterClient } from "@orpc/server";
import { createAgentUIStreamResponse } from "ai";
import { eq } from "drizzle-orm";
import { createApp } from "./__core/app";
import { buildCopilot } from "./agent/copilot";
import { auth } from "./auth";
import { buildInterviewInstructions } from "./lib/interview-prompt";
import { resolveVoice } from "./lib/voices";
import { resolveQuestionSet } from "./routes/question-sets";
import { getSettings as getAgencySettings } from "./middleware/auth";
import { startBackupScheduler } from "./lib/backup-scheduler";
import { startInviteScheduler } from "./lib/invite-scheduler";
import { clientIp, consume, httpsOnly, LOGIN_LIMIT, resetLimit } from "./lib/security";
import { FLAG_WARNING, inspectFrame } from "./lib/proctor";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { BUCKET, s3 } from "./lib/s3";
import { db } from "./database";
import * as schema from "./database/schema";
import { aiInterviews } from "./routes/ai-interviews";
import { backup } from "./routes/backup";
import { candidates } from "./routes/candidates";
import { clients } from "./routes/clients";
import { dashboard } from "./routes/dashboard";
import { demo } from "./routes/demo";
import { jobs } from "./routes/jobs";
import { matching } from "./routes/matching";
import { matrix } from "./routes/matrix";
import { ping } from "./routes/ping";
import { placements } from "./routes/placements";
import { questionSets } from "./routes/question-sets";
import { reports } from "./routes/reports";
import { screening } from "./routes/screening";
import { session } from "./routes/session";
import { settings } from "./routes/settings";
import { talent } from "./routes/talent";
import { techInterviews } from "./routes/tech-interviews";
import { upload } from "./routes/upload";

// API features are oRPC procedures, one file per feature in ./routes/,
// composed into this router — typed end-to-end via the clients
// (web: src/web/lib/api.ts, mobile: lib/api.ts).
export const router = {
  ping,
  session,
  upload,
  clients,
  jobs,
  candidates,
  matching,
  matrix,
  screening,
  aiInterviews,
  techInterviews,
  placements,
  talent,
  questionSets,
  reports,
  dashboard,
  settings,
  backup,
  demo,
};

export type AppRouter = typeof router;
/** Typed client for the router — used by the web and mobile api clients. */
export type AppRouterClient = RouterClient<AppRouter>;

const app = createApp(router);

/* ------------------------------------------------------ Security middleware */
/* HTTPS + HSTS everywhere except local/private hosts. */
app.use("*", httpsOnly);

/* Rate limit the credential endpoints: per IP and, when we can see it, per
   account, so one attacker cannot spray a single mailbox from many addresses. */
app.use("/api/auth/sign-in/*", async (c, next) => {
  const ip = clientIp(c);
  const keys = [`login:ip:${ip}`];

  let email: string | undefined;
  try {
    const clone = c.req.raw.clone();
    const body = (await clone.json()) as { email?: string };
    email = body.email?.toLowerCase().trim();
  } catch {
    /* Non-JSON body (OAuth callbacks) — IP limiting still applies. */
  }
  if (email) keys.push(`login:email:${email}`);

  for (const key of keys) {
    const result = consume(key, LOGIN_LIMIT);
    if (!result.allowed) {
      c.header("Retry-After", String(result.retryAfterSeconds));
      return c.json(
        {
          error: "too_many_attempts",
          message: `Too many sign-in attempts. Try again in ${Math.ceil(result.retryAfterSeconds / 60)} minute(s).`,
        },
        429,
      );
    }
  }

  await next();

  /* A successful sign-in clears the counters for that identity. */
  if (c.res.status < 400) for (const key of keys) resetLimit(key);
});

/* ------------------------------------------------------------- Better Auth */
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

/* --------------------------------------------- AI Recruiter Copilot stream */
app.post("/api/agent/messages", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const raw = session.user as typeof session.user & { agencyId?: string | null };
  if (!raw.agencyId) return c.json({ error: "No workspace" }, 403);

  const { messages } = (await c.req.json()) as { messages: unknown[] };
  const agent = buildCopilot(raw.agencyId, session.user.name);
  return createAgentUIStreamResponse({ agent, uiMessages: messages as never });
});

/* ------------------------------- OpenAI Realtime ephemeral key (AI voice) */
/** GA Realtime speech-to-speech model used for the live voice interview. */
const REALTIME_MODEL = "gpt-realtime-2.1";

/**
 * Mints a short-lived Realtime session for a candidate interview room. The
 * candidate never sees the account key — only this ephemeral client secret,
 * and only for a valid, unexpired interview token.
 */
app.post("/api/ai-interview/session", async (c) => {
  const { token } = (await c.req.json()) as { token?: string };
  if (!token) return c.json({ error: "Missing token" }, 400);

  const [interview] = await db
    .select()
    .from(schema.interviewsAi)
    .where(eq(schema.interviewsAi.token, token))
    .limit(1);

  if (!interview) return c.json({ error: "Invalid interview link" }, 404);
  if (interview.status === "completed") return c.json({ error: "Interview already completed" }, 409);
  if (interview.expiresAt && interview.expiresAt.getTime() < Date.now()) {
    return c.json({ error: "This interview link has expired" }, 410);
  }
  if (!interview.consentGiven) return c.json({ error: "Consent required before starting" }, 403);

  const key = process.env.OPENAI_API_KEY;
  if (!key) return c.json({ error: "voice_unavailable", reason: "No OpenAI key configured" }, 503);

  const [candidate] = await db
    .select()
    .from(schema.candidates)
    .where(eq(schema.candidates.id, interview.candidateId))
    .limit(1);

  const job = interview.jdId
    ? (
        await db
          .select()
          .from(schema.jobDescriptions)
          .where(eq(schema.jobDescriptions.id, interview.jdId))
          .limit(1)
      )[0]
    : undefined;

  const settings = await getAgencySettings(interview.agencyId);
  /* A set chosen in the invite modal is authoritative. Only fall back to the
     JD/title match when the invite did not pin one. */
  const pinned = interview.questionSetId
    ? (
        await db
          .select()
          .from(schema.aiQuestionSets)
          .where(eq(schema.aiQuestionSets.id, interview.questionSetId))
          .limit(1)
      )[0]
    : undefined;
  const questionSet =
    pinned ?? (await resolveQuestionSet(interview.agencyId, interview.jdId, job?.title ?? null));

  /* Remember which set actually drove this interview, for the report. */
  if (questionSet?.id && interview.questionSetId !== questionSet.id) {
    await db
      .update(schema.interviewsAi)
      .set({ questionSetId: questionSet.id })
      .where(eq(schema.interviewsAi.id, interview.id));
  }

  const instructions = buildInterviewInstructions({
    candidateName: candidate ? `${candidate.firstName} ${candidate.lastName ?? ""}`.trim() : "the candidate",
    candidateHeadline: candidate?.headline ?? null,
    candidateSkills: candidate?.skillsExtracted ?? [],
    jobTitle: job?.title ?? null,
    jobLocation: job?.location ?? null,
    jobSkills: job?.skillsRequired ?? job?.parsed?.skills ?? [],
    questions: questionSet?.questions ?? [],
    questionSetTitle: questionSet?.jobTitle ?? null,
    settings,
  });

  /* Falls back to a natural male voice if the setting is empty or unsupported. */
  const REALTIME_VOICE = resolveVoice(settings.aiVoice);

  try {
    const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: REALTIME_MODEL,
          instructions,
          output_modalities: ["audio"],
          audio: {
            input: {
              /* The full transcribe model, not mini: the candidate's words are
                 the evidence the grader scores, and accents plus a laptop mic
                 are exactly where mini drops words. */
              transcription: { model: "gpt-4o-transcribe", language: "en" },
              /* Room noise — a fan, traffic, a keyboard, other people talking —
                 was being picked up as speech and cutting the candidate's turn
                 short. Near-field is the right profile for a laptop headset. */
              noise_reduction: { type: "near_field" },
              /* Semantic turn detection waits for a semantically complete turn
                 instead of a fixed silence window, so the interviewer stops
                 cutting in while the candidate is still thinking.
                 `interrupt_response: false` stops a cough, a bang or a filler
                 from killing the interviewer mid-question; the room yields
                 deliberately when the candidate is genuinely speaking. */
              turn_detection: {
                type: "semantic_vad",
                eagerness: "low",
                create_response: true,
                interrupt_response: false,
              },
            },
            output: { voice: REALTIME_VOICE, speed: 1 },
          },
          /* The interviewer closes the call itself the moment the question set
             is finished, instead of the room sitting idle until the hard time
             cap. */
          tools: [
            {
              type: "function",
              name: "end_interview",
              description:
                "Call this immediately after you have spoken your closing words, once every question in your set has been asked and answered (or the candidate has ended the conversation). Ends the call and submits the interview. Never call it before your closing words, and never call it while questions remain.",
              parameters: {
                type: "object",
                properties: {
                  reason: {
                    type: "string",
                    description:
                      "Short internal note: 'all questions covered', 'candidate asked to stop', etc. The candidate never sees this.",
                  },
                },
                required: ["reason"],
                additionalProperties: false,
              },
            },
          ],
          tool_choice: "auto",
        },
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      return c.json({ error: "voice_unavailable", reason: detail.slice(0, 300) }, 503);
    }
    const data = (await res.json()) as {
      value?: string;
      session?: { model?: string };
    };
    if (!data.value) return c.json({ error: "voice_unavailable", reason: "No client secret" }, 503);
    return c.json(
      {
        clientSecret: data.value,
        model: data.session?.model ?? REALTIME_MODEL,
        instructions,
        /* The room UI enforces the same limits client-side. */
        minMinutes: settings.aiInterviewMinMinutes,
        maxMinutes: settings.aiInterviewMaxMinutes,
        silenceNudgeSeconds: settings.aiSilenceNudgeSeconds,
        questionCount: questionSet?.questions?.length ?? 0,
        /* The room matches these against what the interviewer actually says, so
           it can close the call itself the moment the set has been covered —
           without depending on the model remembering to call `end_interview`. */
        questions: (questionSet?.questions ?? []).map((q) => q.question),
        questionSetId: questionSet?.id ?? null,
        voice: REALTIME_VOICE,
        proctoringEnabled: settings.aiProctoringEnabled,
        awayPenaltyMultiplier: settings.aiAwayPenaltyMultiplier,
      },
      200,
    );
  } catch (error) {
    return c.json({ error: "voice_unavailable", reason: (error as Error).message }, 503);
  }
});

/**
 * Audio sample of an interviewer voice, so the agency can hear whether it sounds
 * like a man before committing it to every candidate interview. Signed-in only —
 * this spends tokens on the account key.
 */
app.get("/api/ai-interview/voice-preview", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) return c.json({ error: "Unauthorized" }, 401);

  const key = process.env.OPENAI_API_KEY;
  if (!key) return c.json({ error: "No OpenAI key configured" }, 503);

  const voice = resolveVoice(c.req.query("voice"));
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice,
      input:
        "Hi, thanks for making the time today. I'm your screening interviewer — before we get into the role, how has your day been going?",
      response_format: "mp3",
    }),
  });
  if (!res.ok) return c.json({ error: (await res.text()).slice(0, 200) }, 503);

  return new Response(await res.arrayBuffer(), {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=3600" },
  });
});

/* ------------------------------------- Candidate A/V evidence + proctoring */

/** Looks up a live interview by its public token. */
async function interviewByToken(token: string | undefined) {
  if (!token) return null;
  const [row] = await db
    .select()
    .from(schema.interviewsAi)
    .where(eq(schema.interviewsAi.token, token))
    .limit(1);
  return row ?? null;
}

/**
 * Presigned PUT so the candidate's browser can upload its own recording of the
 * interview straight to object storage. Token-gated — no session required.
 */
app.post("/api/ai-interview/recording-url", async (c) => {
  const { token, contentType } = (await c.req.json()) as { token?: string; contentType?: string };
  const interview = await interviewByToken(token);
  if (!interview) return c.json({ error: "Invalid interview link" }, 404);

  const extension = (contentType ?? "").includes("mp4") ? "mp4" : "webm";
  const key = `${interview.agencyId}/recording/${interview.id}-${Date.now()}.${extension}`;
  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType ?? "video/webm" }),
    { expiresIn: 3600 },
  );
  return c.json({ url, key });
});

/**
 * Inspects one webcam frame for integrity signals and returns the warning the
 * room should read out to the candidate. Frames are never stored.
 */
app.post("/api/ai-interview/proctor", async (c) => {
  const { token, frame } = (await c.req.json()) as { token?: string; frame?: string };
  const interview = await interviewByToken(token);
  if (!interview) return c.json({ error: "Invalid interview link" }, 404);
  if (!frame) return c.json({ error: "Missing frame" }, 400);

  const settings = await getAgencySettings(interview.agencyId);
  if (!settings.aiProctoringEnabled) return c.json({ flags: [], warnings: [] });

  const reading = await inspectFrame(frame);
  return c.json({
    flags: reading.flags,
    positives: reading.positives,
    warnings: reading.flags.map((flag) => FLAG_WARNING[flag]),
    note: reading.note,
    confidence: reading.confidence,
  });
});

/* Automatic backups tick in-process once the server is up. */
startBackupScheduler();
/* Interview invitations the recruiter scheduled for later are released here. */
startInviteScheduler();

export default app;
