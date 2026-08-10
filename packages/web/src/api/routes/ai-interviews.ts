import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { db } from "../database";
import * as schema from "../database/schema";
import { newId, newToken } from "../lib/ids";
import { base } from "../__core/app";
import {
  audit,
  authed,
  getSettings,
  notify,
  timeline,
} from "../middleware/auth";
import { summariseProctoring } from "../lib/proctor";
import { gradeInterview, toStoredAssessment } from "../lib/interview-grade";
import {
  interviewInviteEmail,
  sendEmail,
  type SendEmailResult,
} from "../lib/email";

/** Absolute base URL for candidate-facing links inside emails. */
function siteUrl(): string {
  return (process.env.WEBSITE_URL ?? "").replace(/\/+$/, "");
}

/**
 * Emails the candidate their interview link. Never throws — the invite itself is
 * already committed and the recruiter can always copy the link by hand.
 */
async function mailInvite(args: {
  agencyId: string;
  to: string | null | undefined;
  candidateName: string;
  jobTitle: string | null;
  token: string;
  expiresAt: Date;
  rescheduled?: boolean;
  scheduledAt?: Date | null;
}): Promise<SendEmailResult & { to: string | null }> {
  if (!args.to) {
    return {
      sent: false,
      reason: "This candidate has no email address on file.",
      to: null,
    };
  }
  const [agency] = await db
    .select({ name: schema.agencies.name })
    .from(schema.agencies)
    .where(eq(schema.agencies.id, args.agencyId))
    .limit(1);
  const settings = await getSettings(args.agencyId);
  const mail = interviewInviteEmail({
    candidateName: args.candidateName,
    jobTitle: args.jobTitle,
    link: `${siteUrl()}/interview/${args.token}`,
    minMinutes: settings.aiInterviewMinMinutes,
    maxMinutes: settings.aiInterviewMaxMinutes,
    expiresAt: args.expiresAt,
    agencyName: agency?.name ?? null,
    rescheduled: args.rescheduled,
    scheduledAt: args.scheduledAt ?? null,
  });
  const result = await sendEmail({ to: args.to, ...mail });
  return { ...result, to: args.to };
}

/**
 * Re-runs the assessment for an interview that already has a transcript and
 * writes the report columns back. Everything else about the row — status,
 * duration, recordings, proctoring counters — is left untouched, so this is
 * safe to call at any time on a finished interview.
 */
async function regradeStored(row: typeof schema.interviewsAi.$inferSelect) {
  const [candidate] = await db
    .select()
    .from(schema.candidates)
    .where(eq(schema.candidates.id, row.candidateId))
    .limit(1);
  const job = row.jdId
    ? (
        await db
          .select()
          .from(schema.jobDescriptions)
          .where(eq(schema.jobDescriptions.id, row.jdId))
          .limit(1)
      )[0]
    : null;
  const questionSet = row.questionSetId
    ? (
        await db
          .select()
          .from(schema.aiQuestionSets)
          .where(eq(schema.aiQuestionSets.id, row.questionSetId))
          .limit(1)
      )[0]
    : undefined;

  const integrity = summariseProctoring({
    focusLossCount: row.focusLossCount,
    awaySeconds: row.awaySeconds,
    timePenaltySeconds: row.timePenaltySeconds,
    fraudFlags: row.fraudFlags ?? [],
    positiveSignals: row.positiveSignals ?? [],
    resumeCount: row.resumeCount,
  });

  const { graded, skipped } = await gradeInterview({
    transcript: row.transcript ?? [],
    questions: questionSet?.questions ?? [],
    questionSetTitle: questionSet?.jobTitle ?? null,
    jobTitle: job?.title ?? null,
    jobSkills: job?.skillsRequired ?? job?.parsed?.skills ?? [],
    candidateHeadline: candidate?.headline ?? null,
    candidateExperienceYears: candidate?.experienceYears ?? null,
    candidateSkills: candidate?.skillsExtracted ?? [],
    durationSeconds: row.durationSeconds,
    integrity,
  });

  await db
    .update(schema.interviewsAi)
    .set({
      assessment: graded ? toStoredAssessment(graded) : null,
      aiSummary: [
        row.status === "terminated"
          ? "INTERVIEW TERMINATED: ended early by the interview system."
          : null,
        graded?.summary ??
          skipped ??
          "Interview completed but could not be graded.",
        graded ? `CONFIDENCE IN THIS ASSESSMENT: ${graded.reliability}` : null,
        graded?.redFlags?.length
          ? `RED FLAGS: ${graded.redFlags.join("; ")}`
          : null,
        `INTEGRITY: ${integrity}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      strengths: graded?.strengths ?? [],
      weaknesses: graded?.weaknesses ?? [],
      suggestedTechFocus: graded?.suggestedTechFocus ?? [],
      selectionReason: graded?.selectionReason ?? null,
      topicCoverage: graded?.topicCoverage ?? [],
    })
    .where(eq(schema.interviewsAi.id, row.id));

  return { graded, skipped };
}

/**
 * AI voice interview. Scores are qualitative only — they never enter the
 * numerical candidate ranking (PRD §7/§9).
 */
export const aiInterviews = {
  list: authed
    .input(z.object({ status: z.string().optional() }).optional())
    .handler(async ({ input, context }) => {
      const where = [eq(schema.interviewsAi.agencyId, context.agencyId)];
      if (input?.status)
        where.push(eq(schema.interviewsAi.status, input.status));

      return db
        .select({
          interview: {
            id: schema.interviewsAi.id,
            token: schema.interviewsAi.token,
            status: schema.interviewsAi.status,
            invitedAt: schema.interviewsAi.invitedAt,
            conductedAt: schema.interviewsAi.conductedAt,
            durationSeconds: schema.interviewsAi.durationSeconds,
            assessment: schema.interviewsAi.assessment,
            aiSummary: schema.interviewsAi.aiSummary,
            candidateId: schema.interviewsAi.candidateId,
            jdId: schema.interviewsAi.jdId,
          },
          candidateNic: schema.candidates.nic,
          candidatePhone: schema.candidates.phone,
          candidateBucket: schema.candidates.bucket,
          candidateName: sql<string>`${schema.candidates.firstName} || ' ' || coalesce(${schema.candidates.lastName}, '')`,
          candidateEmail: schema.candidates.email,
          jobTitle: schema.jobDescriptions.title,
        })
        .from(schema.interviewsAi)
        .innerJoin(
          schema.candidates,
          eq(schema.candidates.id, schema.interviewsAi.candidateId),
        )
        .leftJoin(
          schema.jobDescriptions,
          eq(schema.jobDescriptions.id, schema.interviewsAi.jdId),
        )
        .where(and(...where))
        .orderBy(desc(schema.interviewsAi.invitedAt))
        .limit(100);
    }),

  /** Candidates cleared by HR and waiting for an AI interview invite. */
  queue: authed.handler(({ context }) =>
    db
      .select({
        id: schema.candidates.id,
        firstName: schema.candidates.firstName,
        lastName: schema.candidates.lastName,
        email: schema.candidates.email,
        headline: schema.candidates.headline,
        currentStatus: schema.candidates.currentStatus,
        /* Date the candidate landed in this queue — what the list filters on. */
        updatedAt: schema.candidates.updatedAt,
      })
      .from(schema.candidates)
      .where(
        and(
          eq(schema.candidates.agencyId, context.agencyId),
          eq(schema.candidates.currentStatus, "ai_interview_pending"),
        ),
      )
      .orderBy(desc(schema.candidates.updatedAt)),
  ),

  get: authed
    .input(z.object({ id: z.string() }))
    .handler(async ({ input, context }) => {
      const [row] = await db
        .select()
        .from(schema.interviewsAi)
        .where(
          and(
            eq(schema.interviewsAi.id, input.id),
            eq(schema.interviewsAi.agencyId, context.agencyId),
          ),
        )
        .limit(1);
      if (!row) throw new ORPCError("NOT_FOUND");
      const [candidate] = await db
        .select()
        .from(schema.candidates)
        .where(eq(schema.candidates.id, row.candidateId))
        .limit(1);
      const job = row.jdId
        ? (
            await db
              .select()
              .from(schema.jobDescriptions)
              .where(eq(schema.jobDescriptions.id, row.jdId))
              .limit(1)
          )[0]
        : null;
      return {
        interview: row,
        candidate: candidate
          ? { ...candidate, cvVector: null, cvText: null }
          : null,
        job: job ? { ...job, jdVector: null } : null,
      };
    }),

  /** Create an invite with a shareable candidate link. */
  invite: authed
    .input(
      z.object({
        candidateId: z.string(),
        jdId: z.string().optional(),
        validDays: z.number().default(7),
        /** Question set the interviewer must work through. Chosen at invite time. */
        questionSetId: z.string().optional(),
        /** Address to invite. Defaults to the candidate's own email. */
        email: z.string().email().optional(),
        /** Recruiter can suppress the email and share the link by hand. */
        sendEmail: z.boolean().default(true),
        /** ISO datetime of the slot booked for the interview. */
        scheduledAt: z.string().optional(),
        /** ISO datetime to release the invitation email. Omit to send at once. */
        sendAt: z.string().optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const [candidate] = await db
        .select()
        .from(schema.candidates)
        .where(
          and(
            eq(schema.candidates.id, input.candidateId),
            eq(schema.candidates.agencyId, context.agencyId),
          ),
        )
        .limit(1);
      if (!candidate)
        throw new ORPCError("NOT_FOUND", { message: "Candidate not found" });

      /* A set picked in the invite modal is authoritative — it is what the
         interviewer will be told to ask, so it must belong to this agency. */
      let questionSet: typeof schema.aiQuestionSets.$inferSelect | undefined;
      if (input.questionSetId) {
        [questionSet] = await db
          .select()
          .from(schema.aiQuestionSets)
          .where(
            and(
              eq(schema.aiQuestionSets.id, input.questionSetId),
              eq(schema.aiQuestionSets.agencyId, context.agencyId),
            ),
          )
          .limit(1);
        if (!questionSet)
          throw new ORPCError("NOT_FOUND", {
            message: "Question set not found",
          });
      }

      const id = newId("aii");
      const token = newToken();
      const scheduledAt = input.scheduledAt
        ? new Date(input.scheduledAt)
        : null;
      /* The link must outlive the slot it was booked for, otherwise a candidate
         invited for next month gets an expired link on the day. */
      const expiresAt = new Date(
        Math.max(
          Date.now() + input.validDays * 86_400_000,
          (scheduledAt?.getTime() ?? 0) + 86_400_000,
        ),
      );
      /* A future send date parks the mail for the scheduler instead of sending. */
      const sendAt = input.sendAt ? new Date(input.sendAt) : null;
      const queued = Boolean(
        input.sendEmail && sendAt && sendAt.getTime() > Date.now() + 30_000,
      );
      const jdId = input.jdId ?? questionSet?.jdId ?? undefined;
      const inviteTo = input.email ?? candidate.email ?? null;
      await db.insert(schema.interviewsAi).values({
        id,
        agencyId: context.agencyId,
        candidateId: input.candidateId,
        jdId,
        questionSetId: questionSet?.id,
        token,
        status: "pending",
        expiresAt,
        scheduledAt,
        inviteEmail: inviteTo,
        inviteSendAt: queued ? sendAt : null,
      });

      await db
        .update(schema.candidates)
        .set({
          currentStatus: "ai_interview_pending",
          currentStage: "ai_interview",
          updatedAt: new Date(),
        })
        .where(eq(schema.candidates.id, input.candidateId));

      /* The invitation email. The link is returned either way, so a mail failure
         never blocks the recruiter. */
      const jobTitle = jdId
        ? ((
            await db
              .select({ title: schema.jobDescriptions.title })
              .from(schema.jobDescriptions)
              .where(eq(schema.jobDescriptions.id, jdId))
              .limit(1)
          )[0]?.title ?? null)
        : null;
      const candidateName =
        `${candidate.firstName} ${candidate.lastName ?? ""}`.trim();
      const mail = queued
        ? {
            sent: false,
            reason: `Invitation queued — it will be emailed to ${inviteTo} on ${sendAt!.toLocaleString()}.`,
            to: inviteTo,
          }
        : input.sendEmail
          ? await mailInvite({
              agencyId: context.agencyId,
              to: inviteTo,
              candidateName,
              jobTitle,
              token,
              expiresAt,
              scheduledAt,
            })
          : { sent: false, reason: "Email was not requested.", to: inviteTo };
      if (!queued && mail.sent) {
        await db
          .update(schema.interviewsAi)
          .set({ inviteSentAt: new Date() })
          .where(eq(schema.interviewsAi.id, id));
      }

      await timeline(
        context.agencyId,
        input.candidateId,
        "ai_interview",
        "AI interview invited",
        `${questionSet ? `Question set: ${questionSet.jobTitle}. ` : ""}${
          scheduledAt ? `Slot: ${scheduledAt.toLocaleString()}. ` : ""
        }Link valid until ${expiresAt.toLocaleDateString()}${
          mail.sent
            ? `. Invitation emailed to ${mail.to}`
            : queued
              ? `. Invitation queued for ${sendAt!.toLocaleString()}`
              : ""
        }`,
        context.user.name,
      );
      await audit(
        context.user,
        "ai_interview.invited",
        "candidate",
        input.candidateId,
        { id },
      );

      return {
        id,
        token,
        link: `/interview/${token}`,
        expiresAt,
        scheduledAt,
        emailSent: mail.sent,
        emailQueuedFor: queued ? sendAt : null,
        emailTo: mail.to,
        emailError: mail.sent ? null : (mail.reason ?? null),
      };
    }),

  /**
   * Re-issue an interview that was never completed: fresh link, fresh expiry,
   * optionally a different question set. The old token stops working, so a
   * candidate who was terminated for suspicious activity cannot resume the
   * abandoned session.
   */
  reschedule: authed
    .input(
      z.object({
        id: z.string(),
        validDays: z.number().min(1).max(90).default(7),
        questionSetId: z.string().optional(),
        reason: z.string().max(300).optional(),
        email: z.string().email().optional(),
        sendEmail: z.boolean().default(true),
        /** ISO datetime of the new slot booked for the interview. */
        scheduledAt: z.string().optional(),
        /** ISO datetime to release the new invitation. Omit to send at once. */
        sendAt: z.string().optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const [row] = await db
        .select()
        .from(schema.interviewsAi)
        .where(
          and(
            eq(schema.interviewsAi.id, input.id),
            eq(schema.interviewsAi.agencyId, context.agencyId),
          ),
        )
        .limit(1);
      if (!row)
        throw new ORPCError("NOT_FOUND", { message: "Interview not found" });

      let questionSetId = row.questionSetId;
      if (input.questionSetId) {
        const [set] = await db
          .select({ id: schema.aiQuestionSets.id })
          .from(schema.aiQuestionSets)
          .where(
            and(
              eq(schema.aiQuestionSets.id, input.questionSetId),
              eq(schema.aiQuestionSets.agencyId, context.agencyId),
            ),
          )
          .limit(1);
        if (!set)
          throw new ORPCError("NOT_FOUND", {
            message: "Question set not found",
          });
        questionSetId = set.id;
      }

      /* A sitting that produced anything at all is archived before the live
         columns are wiped, so re-scheduling a completed interview never destroys
         the report or the recording that came with it. */
      const hadAttempt = Boolean(
        row.conductedAt ||
        (row.transcript ?? []).length > 0 ||
        row.aiSummary ||
        row.videoUrl,
      );
      const attempts: schema.AiInterviewAttempt[] = [
        ...(row.previousAttempts ?? []),
      ];
      if (hadAttempt) {
        attempts.push({
          at: Date.now(),
          status: row.status,
          conductedAt: row.conductedAt ? row.conductedAt.getTime() : null,
          durationSeconds: row.durationSeconds ?? null,
          aiSummary: row.aiSummary ?? null,
          assessment: row.assessment ?? null,
          transcript: row.transcript ?? [],
          videoUrl: row.videoUrl ?? null,
          audioUrl: row.audioUrl ?? null,
          fraudFlags: row.fraudFlags ?? [],
          focusLossCount: row.focusLossCount,
          awaySeconds: row.awaySeconds,
          rescheduledBy: context.user.name,
          reason: input.reason ?? null,
        });
      }

      const scheduledAt = input.scheduledAt
        ? new Date(input.scheduledAt)
        : null;
      const expiresAt = new Date(
        Math.max(
          Date.now() + input.validDays * 86_400_000,
          (scheduledAt?.getTime() ?? 0) + 86_400_000,
        ),
      );
      const sendAt = input.sendAt ? new Date(input.sendAt) : null;
      const queued = Boolean(
        input.sendEmail && sendAt && sendAt.getTime() > Date.now() + 30_000,
      );
      const token = newToken();
      await db
        .update(schema.interviewsAi)
        .set({
          token,
          questionSetId,
          status: "pending",
          scheduledAt,
          inviteSendAt: queued ? sendAt : null,
          inviteSentAt: null,
          inviteIsReschedule: true,
          resumeCount: 0,
          lastSeenAt: null,
          positiveSignals: [],
          previousAttempts: attempts.slice(-10),
          videoUrl: null,
          audioUrl: null,
          expiresAt,
          /* A rescheduled interview starts clean — old partial evidence would
             otherwise be graded together with the new attempt. */
          consentGiven: false,
          identityVerified: false,
          conductedAt: null,
          durationSeconds: null,
          transcript: [],
          assessment: null,
          aiSummary: null,
          strengths: [],
          weaknesses: [],
          suggestedTechFocus: [],
          selectionReason: null,
          topicCoverage: [],
          focusLossCount: 0,
          awaySeconds: 0,
          timePenaltySeconds: 0,
          fraudFlags: [],
          proctorEvents: [],
        })
        .where(eq(schema.interviewsAi.id, row.id));

      await db
        .update(schema.candidates)
        .set({
          currentStatus: "ai_interview_pending",
          currentStage: "ai_interview",
          updatedAt: new Date(),
        })
        .where(eq(schema.candidates.id, row.candidateId));

      const [candidate] = await db
        .select({
          firstName: schema.candidates.firstName,
          lastName: schema.candidates.lastName,
          email: schema.candidates.email,
        })
        .from(schema.candidates)
        .where(eq(schema.candidates.id, row.candidateId))
        .limit(1);
      const jobTitle = row.jdId
        ? ((
            await db
              .select({ title: schema.jobDescriptions.title })
              .from(schema.jobDescriptions)
              .where(eq(schema.jobDescriptions.id, row.jdId))
              .limit(1)
          )[0]?.title ?? null)
        : null;

      const inviteTo = input.email ?? candidate?.email ?? null;
      await db
        .update(schema.interviewsAi)
        .set({ inviteEmail: inviteTo })
        .where(eq(schema.interviewsAi.id, row.id));
      const mail = queued
        ? {
            sent: false,
            reason: `New link queued — it will be emailed to ${inviteTo} on ${sendAt!.toLocaleString()}.`,
            to: inviteTo,
          }
        : input.sendEmail
          ? await mailInvite({
              agencyId: context.agencyId,
              to: inviteTo,
              candidateName:
                `${candidate?.firstName ?? ""} ${candidate?.lastName ?? ""}`.trim() ||
                "there",
              jobTitle,
              token,
              expiresAt,
              rescheduled: true,
              scheduledAt,
            })
          : { sent: false, reason: "Email was not requested.", to: inviteTo };
      if (!queued && mail.sent) {
        await db
          .update(schema.interviewsAi)
          .set({ inviteSentAt: new Date() })
          .where(eq(schema.interviewsAi.id, row.id));
      }

      await timeline(
        context.agencyId,
        row.candidateId,
        "ai_interview",
        "AI interview rescheduled",
        `${input.reason ?? `New link valid until ${expiresAt.toLocaleDateString()}`}${
          scheduledAt ? `. New slot: ${scheduledAt.toLocaleString()}` : ""
        }${hadAttempt ? ". Previous attempt archived on the report" : ""}${
          mail.sent
            ? `. New link emailed to ${mail.to}`
            : queued
              ? `. Mail queued for ${sendAt!.toLocaleString()}`
              : ""
        }`,
        context.user.name,
      );
      await audit(
        context.user,
        "ai_interview.rescheduled",
        "candidate",
        row.candidateId,
        { id: row.id },
      );

      return {
        id: row.id,
        token,
        link: `/interview/${token}`,
        archivedAttempt: hadAttempt,
        expiresAt,
        scheduledAt,
        emailSent: mail.sent,
        emailQueuedFor: queued ? sendAt : null,
        emailTo: mail.to,
        emailError: mail.sent ? null : (mail.reason ?? null),
      };
    }),

  /** Public: the candidate interview room loads its own context by token. */
  byToken: base
    .input(z.object({ token: z.string() }))
    .handler(async ({ input }) => {
      const [row] = await db
        .select()
        .from(schema.interviewsAi)
        .where(eq(schema.interviewsAi.token, input.token))
        .limit(1);
      if (!row)
        throw new ORPCError("NOT_FOUND", {
          message: "This interview link is not valid",
        });
      if (
        row.expiresAt &&
        row.expiresAt.getTime() < Date.now() &&
        row.status === "pending"
      ) {
        await db
          .update(schema.interviewsAi)
          .set({ status: "expired" })
          .where(eq(schema.interviewsAi.id, row.id));
        throw new ORPCError("FORBIDDEN", {
          message: "This interview link has expired",
        });
      }

      const [candidate] = await db
        .select({
          firstName: schema.candidates.firstName,
          lastName: schema.candidates.lastName,
          headline: schema.candidates.headline,
          technologies: schema.candidates.technologies,
          skillsExtracted: schema.candidates.skillsExtracted,
          experienceYears: schema.candidates.experienceYears,
        })
        .from(schema.candidates)
        .where(eq(schema.candidates.id, row.candidateId))
        .limit(1);

      const job = row.jdId
        ? (
            await db
              .select({
                title: schema.jobDescriptions.title,
                parsed: schema.jobDescriptions.parsed,
              })
              .from(schema.jobDescriptions)
              .where(eq(schema.jobDescriptions.id, row.jdId))
              .limit(1)
          )[0]
        : null;

      return {
        id: row.id,
        status: row.status,
        consentGiven: row.consentGiven,
        identityVerified: row.identityVerified,
        transcript: row.transcript ?? [],
        candidate: candidate ?? null,
        job: job ?? null,
        scheduledAt: row.scheduledAt,
        expiresAt: row.expiresAt,
        /* Resume state: an interview left in progress (browser reload, crash, lost
         tab) is picked up where it stopped rather than restarted or lost. */
        resumable: row.status === "in_progress",
        startedAt: row.conductedAt,
        awaySeconds: row.awaySeconds,
        timePenaltySeconds: row.timePenaltySeconds,
        resumeCount: row.resumeCount,
        lastSeenAt: row.lastSeenAt,
      };
    }),

  /**
   * Public: the room is alive. Keeps `lastSeenAt` fresh so that if the candidate
   * reloads or their browser dies, the gap can be priced exactly as inactive
   * time rather than being silently forgiven.
   */
  heartbeat: base
    .input(z.object({ token: z.string() }))
    .handler(async ({ input }) => {
      await db
        .update(schema.interviewsAi)
        .set({ lastSeenAt: new Date() })
        .where(eq(schema.interviewsAi.token, input.token));
      return { ok: true };
    }),

  /**
   * Public: rejoin an interview that is already in progress. The time between the
   * last heartbeat and now is counted as time away from the interview (and
   * deducted from the remaining window at the agency's penalty multiplier), so a
   * reload is never a free break.
   */
  resume: base
    .input(z.object({ token: z.string() }))
    .handler(async ({ input }) => {
      const [row] = await db
        .select()
        .from(schema.interviewsAi)
        .where(eq(schema.interviewsAi.token, input.token))
        .limit(1);
      if (!row)
        throw new ORPCError("NOT_FOUND", {
          message: "This interview link is not valid",
        });
      if (row.status !== "in_progress") {
        throw new ORPCError("FORBIDDEN", {
          message: "This interview is not in progress",
        });
      }

      const settings = await getSettings(row.agencyId);
      const now = Date.now();
      const gapSeconds = row.lastSeenAt
        ? Math.max(0, Math.round((now - row.lastSeenAt.getTime()) / 1000))
        : 0;
      /* A moment's gap is just a page paint, not an absence. */
      const away = gapSeconds > 5 ? gapSeconds : 0;
      const penalty = Math.round(away * settings.aiAwayPenaltyMultiplier);

      await db
        .update(schema.interviewsAi)
        .set({
          resumeCount: row.resumeCount + 1,
          lastSeenAt: new Date(),
          awaySeconds: row.awaySeconds + away,
          timePenaltySeconds: row.timePenaltySeconds + penalty,
          focusLossCount: row.focusLossCount + (away > 0 ? 1 : 0),
          fraudFlags:
            away > 30
              ? [...new Set([...(row.fraudFlags ?? []), "left_interview"])]
              : (row.fraudFlags ?? []),
          proctorEvents: [
            ...(row.proctorEvents ?? []),
            {
              at: now,
              kind: "resumed",
              detail: `Candidate rejoined the interview after ${away}s away (attempt ${row.resumeCount + 1})`,
              flags: away > 30 ? ["left_interview"] : [],
            },
          ].slice(-200),
        })
        .where(eq(schema.interviewsAi.id, row.id));

      await timeline(
        row.agencyId,
        row.candidateId,
        "ai_interview",
        "AI interview resumed",
        `Rejoined after ${away}s away — ${penalty}s deducted from the remaining interview time`,
        "AI Interviewer",
      );

      return {
        ok: true,
        transcript: row.transcript ?? [],
        startedAt: row.conductedAt,
        awaySeconds: row.awaySeconds + away,
        timePenaltySeconds: row.timePenaltySeconds + penalty,
        gapSeconds: away,
        resumeCount: row.resumeCount + 1,
      };
    }),

  /** Public: identity + camera/mic consent gate. */
  consent: base
    .input(
      z.object({
        token: z.string(),
        identityVerified: z.boolean(),
        consentGiven: z.boolean(),
      }),
    )
    .handler(async ({ input }) => {
      await db
        .update(schema.interviewsAi)
        .set({
          identityVerified: input.identityVerified,
          consentGiven: input.consentGiven,
        })
        .where(eq(schema.interviewsAi.token, input.token));
      return { ok: true };
    }),

  /**
   * Public: the candidate's camera or microphone never came up, so the interview
   * was never conducted. The invite is left usable and the recruiter is told to
   * arrange a new slot — exactly what the candidate is asked to do on screen.
   */
  deviceFailure: base
    .input(
      z.object({
        token: z.string(),
        detail: z.string().max(300).optional(),
        camera: z.boolean().default(false),
        microphone: z.boolean().default(false),
      }),
    )
    .handler(async ({ input }) => {
      const [row] = await db
        .select({
          id: schema.interviewsAi.id,
          agencyId: schema.interviewsAi.agencyId,
          candidateId: schema.interviewsAi.candidateId,
          proctorEvents: schema.interviewsAi.proctorEvents,
        })
        .from(schema.interviewsAi)
        .where(eq(schema.interviewsAi.token, input.token))
        .limit(1);
      if (!row) throw new ORPCError("NOT_FOUND");

      const missing = [
        !input.camera ? "camera" : null,
        !input.microphone ? "microphone" : null,
      ]
        .filter(Boolean)
        .join(" and ");
      const detail =
        input.detail ?? `No working ${missing || "camera or microphone"}`;

      await db
        .update(schema.interviewsAi)
        .set({
          proctorEvents: [
            ...(row.proctorEvents ?? []),
            {
              at: Date.now(),
              kind: "device_check_failed",
              detail,
              flags: ["device_check_failed"],
            },
          ].slice(-200),
        })
        .where(eq(schema.interviewsAi.id, row.id));

      const [candidate] = await db
        .select({
          firstName: schema.candidates.firstName,
          lastName: schema.candidates.lastName,
        })
        .from(schema.candidates)
        .where(eq(schema.candidates.id, row.candidateId))
        .limit(1);

      await timeline(
        row.agencyId,
        row.candidateId,
        "ai_interview",
        "AI interview not started — device check failed",
        detail,
        "AI Interviewer",
      );
      await notify(
        row.agencyId,
        "Candidate could not start their interview",
        `${candidate?.firstName ?? "A candidate"} ${candidate?.lastName ?? ""}`.trim() +
          ` could not start the AI interview — ${detail}. They were asked to contact HR for a new slot.`,
        "warning",
        "/ai-interviews",
      );
      return { ok: true };
    }),

  /**
   * Public: something broke inside the candidate's interview room (usually the
   * voice service). The candidate only ever sees a polite notice, so the exact
   * provider error is escalated to the super admins here instead.
   */
  reportError: base
    .input(
      z.object({
        token: z.string().optional(),
        scope: z.string().max(60).default("ai_interview"),
        message: z.string().max(2000),
      }),
    )
    .handler(async ({ input }) => {
      const row = input.token
        ? (
            await db
              .select({
                id: schema.interviewsAi.id,
                agencyId: schema.interviewsAi.agencyId,
                candidateId: schema.interviewsAi.candidateId,
              })
              .from(schema.interviewsAi)
              .where(eq(schema.interviewsAi.token, input.token))
              .limit(1)
          )[0]
        : undefined;

      const agencyId =
        row?.agencyId ??
        (await db.select().from(schema.agencies).limit(1))[0]?.id;
      if (!agencyId) return { ok: false };

      const candidate = row
        ? (
            await db
              .select({
                firstName: schema.candidates.firstName,
                lastName: schema.candidates.lastName,
              })
              .from(schema.candidates)
              .where(eq(schema.candidates.id, row.candidateId))
              .limit(1)
          )[0]
        : undefined;
      const who = candidate
        ? `${candidate.firstName} ${candidate.lastName ?? ""}`.trim()
        : "A candidate";

      /* Addressed to every super admin so it lands in an owner's inbox rather
         than the general agency feed. */
      const admins = await db
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(
          and(
            eq(schema.user.agencyId, agencyId),
            eq(schema.user.role, "super_admin"),
          ),
        )
        .limit(20);

      const title = `Voice agent failure — ${input.scope}`;
      const body = `${who}'s interview room reported: ${input.message.slice(0, 1200)}`;
      if (admins.length === 0) {
        await notify(agencyId, title, body, "error", "/ai-interviews");
      } else {
        await db.insert(schema.notifications).values(
          admins.map((admin) => ({
            id: newId("ntf"),
            agencyId,
            userId: admin.id,
            title,
            body,
            kind: "error",
            link: "/ai-interviews",
          })),
        );
      }

      if (row) {
        await timeline(
          agencyId,
          row.candidateId,
          "ai_interview",
          "Interview room error",
          input.message.slice(0, 200),
          "System",
        );
      }
      return { ok: true };
    }),

  /** Public: mark the session live. */
  start: base
    .input(z.object({ token: z.string() }))
    .handler(async ({ input }) => {
      const [existing] = await db
        .select({
          id: schema.interviewsAi.id,
          conductedAt: schema.interviewsAi.conductedAt,
        })
        .from(schema.interviewsAi)
        .where(eq(schema.interviewsAi.token, input.token))
        .limit(1);
      if (!existing) throw new ORPCError("NOT_FOUND");
      const now = new Date();
      await db
        .update(schema.interviewsAi)
        .set({
          status: "in_progress",
          /* A resumed sitting keeps its original start time, so the clock the
           candidate is measured against never restarts. */
          conductedAt: existing.conductedAt ?? now,
          lastSeenAt: now,
        })
        .where(eq(schema.interviewsAi.id, existing.id));
      return { ok: true, startedAt: existing.conductedAt ?? now };
    }),

  /** Public: append transcript turns as the conversation happens. */
  appendTranscript: base
    .input(
      z.object({
        token: z.string(),
        turns: z.array(
          z.object({
            role: z.enum(["ai", "candidate"]),
            text: z.string(),
            at: z.number(),
          }),
        ),
      }),
    )
    .handler(async ({ input }) => {
      const [row] = await db
        .select({
          id: schema.interviewsAi.id,
          transcript: schema.interviewsAi.transcript,
        })
        .from(schema.interviewsAi)
        .where(eq(schema.interviewsAi.token, input.token))
        .limit(1);
      if (!row) throw new ORPCError("NOT_FOUND");
      await db
        .update(schema.interviewsAi)
        .set({
          transcript: [...(row.transcript ?? []), ...input.turns],
          lastSeenAt: new Date(),
        })
        .where(eq(schema.interviewsAi.id, row.id));
      return { ok: true };
    }),

  /**
   * Public: record a proctoring event (tab away, camera signal) as it happens so
   * the evidence survives even if the candidate never finishes the interview.
   */
  proctorEvent: base
    .input(
      z.object({
        token: z.string(),
        kind: z.enum([
          "focus_lost",
          "focus_regained",
          "camera_signal",
          "warning_shown",
          "resumed",
          "positive_signal",
        ]),
        detail: z.string().max(300).optional(),
        awaySeconds: z.number().min(0).max(3600).default(0),
        flags: z.array(z.string().max(40)).max(10).default([]),
        /** Positive behavioural observations, e.g. ["strong_eye_contact"]. */
        positives: z.array(z.string().max(40)).max(10).default([]),
      }),
    )
    .handler(async ({ input }) => {
      const [row] = await db
        .select({
          id: schema.interviewsAi.id,
          focusLossCount: schema.interviewsAi.focusLossCount,
          awaySeconds: schema.interviewsAi.awaySeconds,
          fraudFlags: schema.interviewsAi.fraudFlags,
          proctorEvents: schema.interviewsAi.proctorEvents,
          positiveSignals: schema.interviewsAi.positiveSignals,
        })
        .from(schema.interviewsAi)
        .where(eq(schema.interviewsAi.token, input.token))
        .limit(1);
      if (!row) throw new ORPCError("NOT_FOUND");

      const events = [
        ...(row.proctorEvents ?? []),
        {
          at: Date.now(),
          kind: input.kind,
          detail: input.detail ?? null,
          flags: [...input.flags, ...input.positives],
        },
      ].slice(-200);

      await db
        .update(schema.interviewsAi)
        .set({
          proctorEvents: events,
          lastSeenAt: new Date(),
          focusLossCount:
            row.focusLossCount + (input.kind === "focus_lost" ? 1 : 0),
          awaySeconds: row.awaySeconds + Math.round(input.awaySeconds),
          fraudFlags: [...new Set([...(row.fraudFlags ?? []), ...input.flags])],
          positiveSignals: [
            ...new Set([...(row.positiveSignals ?? []), ...input.positives]),
          ],
        })
        .where(eq(schema.interviewsAi.id, row.id));

      return { ok: true };
    }),

  /**
   * Public: end the interview and grade it. Produces the qualitative AI report
   * (assessment radar, strengths, weaknesses, tech focus areas).
   */
  finish: base
    .input(
      z.object({
        token: z.string(),
        durationSeconds: z.number().default(0),
        recordingKey: z.string().optional(),
        videoKey: z.string().optional(),
        focusLossCount: z.number().min(0).default(0),
        awaySeconds: z.number().min(0).default(0),
        timePenaltySeconds: z.number().min(0).default(0),
        fraudFlags: z.array(z.string().max(40)).max(20).default([]),
        /** Positive behavioural signals observed during proctoring. */
        positiveSignals: z.array(z.string().max(40)).max(10).default([]),
        /** Set when the room cut the interview short (inactivity, hard time cap). */
        terminated: z.boolean().default(false),
        terminationReason: z.string().max(200).optional(),
      }),
    )
    .handler(async ({ input }) => {
      const [row] = await db
        .select()
        .from(schema.interviewsAi)
        .where(eq(schema.interviewsAi.token, input.token))
        .limit(1);
      if (!row) throw new ORPCError("NOT_FOUND");

      const [candidate] = await db
        .select()
        .from(schema.candidates)
        .where(eq(schema.candidates.id, row.candidateId))
        .limit(1);
      const job = row.jdId
        ? (
            await db
              .select()
              .from(schema.jobDescriptions)
              .where(eq(schema.jobDescriptions.id, row.jdId))
              .limit(1)
          )[0]
        : null;

      /* Integrity first — the grader is told how the interview was actually sat,
         so an off-screen candidate cannot score like one who stayed present. */
      const integrity = summariseProctoring({
        focusLossCount: Math.max(row.focusLossCount, input.focusLossCount),
        awaySeconds: Math.max(row.awaySeconds, Math.round(input.awaySeconds)),
        timePenaltySeconds: Math.round(input.timePenaltySeconds),
        fraudFlags: [
          ...new Set([...(row.fraudFlags ?? []), ...input.fraudFlags]),
        ],
        positiveSignals: [
          ...new Set([
            ...(row.positiveSignals ?? []),
            ...input.positiveSignals,
          ]),
        ],
        resumeCount: row.resumeCount,
      });
      /* Sustained eye contact is reported to the recruiter as a positive read on
         the candidate's confidence, separately from the grader's own score. */
      const confidentPresence = [
        ...(row.positiveSignals ?? []),
        ...input.positiveSignals,
      ].includes("strong_eye_contact");

      /* Grade against the recruiter's own question set, not a generic rubric. */
      const questionSet = row.questionSetId
        ? (
            await db
              .select()
              .from(schema.aiQuestionSets)
              .where(eq(schema.aiQuestionSets.id, row.questionSetId))
              .limit(1)
          )[0]
        : undefined;

      const { graded, skipped } = await gradeInterview({
        transcript: row.transcript ?? [],
        questions: questionSet?.questions ?? [],
        questionSetTitle: questionSet?.jobTitle ?? null,
        jobTitle: job?.title ?? null,
        jobSkills: job?.skillsRequired ?? job?.parsed?.skills ?? [],
        candidateHeadline: candidate?.headline ?? null,
        candidateExperienceYears: candidate?.experienceYears ?? null,
        candidateSkills: candidate?.skillsExtracted ?? [],
        durationSeconds: input.durationSeconds,
        integrity,
      });

      const flags = [
        ...new Set([...(row.fraudFlags ?? []), ...input.fraudFlags]),
      ];
      const suspicious =
        input.terminated && flags.some((f) => f !== "no_camera");

      await db
        .update(schema.interviewsAi)
        .set({
          status: input.terminated ? "terminated" : "completed",
          durationSeconds: input.durationSeconds,
          audioUrl: input.recordingKey ?? row.audioUrl,
          videoUrl: input.videoKey ?? row.videoUrl,
          focusLossCount: Math.max(row.focusLossCount, input.focusLossCount),
          awaySeconds: Math.max(row.awaySeconds, Math.round(input.awaySeconds)),
          timePenaltySeconds: Math.round(input.timePenaltySeconds),
          fraudFlags: [
            ...new Set([...(row.fraudFlags ?? []), ...input.fraudFlags]),
          ],
          positiveSignals: [
            ...new Set([
              ...(row.positiveSignals ?? []),
              ...input.positiveSignals,
            ]),
          ],
          assessment: graded ? toStoredAssessment(graded) : null,
          aiSummary: [
            input.terminated
              ? `INTERVIEW TERMINATED: ${input.terminationReason ?? "ended early by the interview system"}.`
              : null,
            graded?.summary ??
              skipped ??
              "Interview completed but could not be graded.",
            graded
              ? `CONFIDENCE IN THIS ASSESSMENT: ${graded.reliability}`
              : null,
            graded?.redFlags?.length
              ? `RED FLAGS: ${graded.redFlags.join("; ")}`
              : null,
            confidentPresence && !input.terminated
              ? "VERY CONFIDENT CANDIDATE: held direct eye contact with the camera throughout the interview."
              : null,
            `INTEGRITY: ${integrity}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
          strengths: graded?.strengths ?? [],
          weaknesses: graded?.weaknesses ?? [],
          suggestedTechFocus: graded?.suggestedTechFocus ?? [],
          selectionReason: graded?.selectionReason ?? null,
          topicCoverage: graded?.topicCoverage ?? [],
        })
        .where(eq(schema.interviewsAi.id, row.id));

      /* Tag the candidate so the AI-interview result is visible everywhere the
         candidate appears, and move them into the technical queue. */
      const existingTags = candidate?.tags ?? [];
      /* A terminated interview must not push the candidate into the technical
         queue as if they had passed a screening — it is flagged for review. */
      await db
        .update(schema.candidates)
        .set(
          input.terminated
            ? {
                currentStatus: "ai_interview_pending",
                currentStage: "ai_interview",
                tags: [
                  ...new Set([
                    ...existingTags,
                    "ai_interview_terminated",
                    ...(suspicious ? ["suspicious_activity"] : []),
                  ]),
                ],
                updatedAt: new Date(),
              }
            : {
                currentStatus: "tech_interview_pending",
                currentStage: "tech_interview",
                tags: [
                  ...new Set([
                    ...existingTags,
                    "ai_interview_finished",
                    ...(confidentPresence ? ["very_confident"] : []),
                  ]),
                ],
                updatedAt: new Date(),
              },
        )
        .where(eq(schema.candidates.id, row.candidateId));

      await timeline(
        row.agencyId,
        row.candidateId,
        "ai_interview",
        input.terminated ? "AI interview terminated" : "AI interview completed",
        input.terminated
          ? (input.terminationReason ?? "Ended early").slice(0, 200)
          : graded?.summary?.slice(0, 200),
        "AI Interviewer",
      );
      await notify(
        row.agencyId,
        input.terminated ? "AI interview terminated" : "AI interview completed",
        input.terminated
          ? `${candidate?.firstName ?? "A candidate"}'s interview was cut short — ${input.terminationReason ?? "flagged for review"}. Reschedule it if appropriate.`
          : `${candidate?.firstName ?? "A candidate"} finished the AI interview — report ready.${
              confidentPresence
                ? " Very confident candidate: held direct eye contact throughout."
                : ""
            }`,
        input.terminated ? "warning" : "info",
        `/ai-interviews`,
      );

      return {
        ok: true,
        graded: Boolean(graded),
        terminated: input.terminated,
      };
    }),

  /**
   * Re-run the assessment from the stored transcript. Used when grading was
   * skipped or failed at the end of the interview, and after a recruiter edits
   * or imports a transcript — so a report is never permanently empty.
   */
  regrade: authed
    .input(z.object({ id: z.string() }))
    .handler(async ({ input, context }) => {
      const [row] = await db
        .select()
        .from(schema.interviewsAi)
        .where(
          and(
            eq(schema.interviewsAi.id, input.id),
            eq(schema.interviewsAi.agencyId, context.agencyId),
          ),
        )
        .limit(1);
      if (!row) throw new ORPCError("NOT_FOUND");

      const result = await regradeStored(row);
      return { ok: result.graded !== null, reason: result.skipped ?? null };
    }),

  /**
   * Completed AI interview results, ready to surface on a candidate card: an
   * overall 0-100 score derived from the six assessment dimensions plus a link
   * straight into the technical interview.
   */
  results: authed
    .input(z.object({ candidateId: z.string().optional() }).optional())
    .handler(async ({ input, context }) => {
      const where = [
        eq(schema.interviewsAi.agencyId, context.agencyId),
        eq(schema.interviewsAi.status, "completed"),
      ];
      if (input?.candidateId)
        where.push(eq(schema.interviewsAi.candidateId, input.candidateId));

      const rows = await db
        .select({
          id: schema.interviewsAi.id,
          candidateId: schema.interviewsAi.candidateId,
          jdId: schema.interviewsAi.jdId,
          conductedAt: schema.interviewsAi.conductedAt,
          durationSeconds: schema.interviewsAi.durationSeconds,
          assessment: schema.interviewsAi.assessment,
          aiSummary: schema.interviewsAi.aiSummary,
          strengths: schema.interviewsAi.strengths,
          weaknesses: schema.interviewsAi.weaknesses,
          suggestedTechFocus: schema.interviewsAi.suggestedTechFocus,
          selectionReason: schema.interviewsAi.selectionReason,
          topicCoverage: schema.interviewsAi.topicCoverage,
          timePenaltySeconds: schema.interviewsAi.timePenaltySeconds,
          focusLossCount: schema.interviewsAi.focusLossCount,
          awaySeconds: schema.interviewsAi.awaySeconds,
          fraudFlags: schema.interviewsAi.fraudFlags,
          candidateName: sql<string>`${schema.candidates.firstName} || ' ' || coalesce(${schema.candidates.lastName}, '')`,
          candidateStatus: schema.candidates.currentStatus,
          candidateEmail: schema.candidates.email,
          jobTitle: schema.jobDescriptions.title,
        })
        .from(schema.interviewsAi)
        .innerJoin(
          schema.candidates,
          eq(schema.candidates.id, schema.interviewsAi.candidateId),
        )
        .leftJoin(
          schema.jobDescriptions,
          eq(schema.jobDescriptions.id, schema.interviewsAi.jdId),
        )
        .where(and(...where))
        .orderBy(desc(schema.interviewsAi.conductedAt))
        .limit(200);

      return rows.map((r) => {
        const a = r.assessment;
        const values = a
          ? [
              a.communication,
              a.confidence,
              a.knowledge,
              a.professionalism,
              a.criticalThinking,
              a.responseConsistency,
            ]
          : [];
        const score = values.length
          ? Math.round(
              (values.reduce((x, y) => x + y, 0) / values.length) * 100,
            ) / 10
          : null;
        return {
          ...r,
          candidateName: r.candidateName.trim(),
          /** 0-100, qualitative only — never enters the numeric ranking. */
          score,
          readyForTechnical: r.candidateStatus === "tech_interview_pending",
        };
      });
    }),
};
