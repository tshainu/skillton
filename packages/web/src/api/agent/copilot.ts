/**
 * AI Recruiter Copilot — a tool-loop agent scoped to one agency. Every tool is
 * bound to the caller's agencyId so the copilot can never read another
 * workspace, and all score reads respect the score-expiry rule (expired scores
 * are reported as expired, never as numbers).
 */
import { ToolLoopAgent, stepCountIs, tool } from "ai";
import dedent from "dedent";
import { and, desc, eq, gt, inArray, like, or, sql } from "drizzle-orm";
import z from "zod";
import { db } from "../database";
import * as schema from "../database/schema";
import { getSettings } from "../middleware/auth";
import { finalScore, isExpired } from "../lib/scoring";
import { REASON_MODEL, gateway } from "./gateway";

const fullName = (c: { firstName: string; lastName: string | null }) =>
  [c.firstName, c.lastName].filter(Boolean).join(" ");

export function buildCopilot(agencyId: string, userName: string) {
  const searchCandidates = tool({
    description:
      "Search the candidate database by free text (name, skill, technology, location or headline). Returns basic profile data. Use before ranking or comparing candidates.",
    inputSchema: z.object({
      query: z.string().describe("Skill, technology, location or name to search for"),
      status: z
        .enum(["any", "new", "screening", "shortlisted", "interviewing", "hired", "rejected", "blacklisted"])
        .default("any"),
      limit: z.number().min(1).max(25).default(10),
    }),
    async execute({ query, status, limit }) {
      const q = `%${query.toLowerCase()}%`;
      const rows = await db
        .select()
        .from(schema.candidates)
        .where(
          and(
            eq(schema.candidates.agencyId, agencyId),
            status === "any" ? undefined : eq(schema.candidates.currentStatus, status),
            or(
              like(sql`lower(${schema.candidates.firstName})`, q),
              like(sql`lower(${schema.candidates.lastName})`, q),
              like(sql`lower(${schema.candidates.headline})`, q),
              like(sql`lower(${schema.candidates.location})`, q),
              like(sql`lower(${schema.candidates.skillsExtracted})`, q),
              like(sql`lower(${schema.candidates.technologies})`, q),
              like(sql`lower(${schema.candidates.cvText})`, q),
            ),
          ),
        )
        .limit(limit);

      return {
        count: rows.length,
        candidates: rows.map((c) => ({
          id: c.id,
          name: fullName(c),
          headline: c.headline,
          location: c.location,
          experienceYears: c.experienceYears,
          skills: (c.skillsExtracted ?? []).slice(0, 15),
          technologies: (c.technologies ?? []).slice(0, 15),
          status: c.currentStatus,
          stage: c.currentStage,
        })),
      };
    },
  });

  const listJobs = tool({
    description: "List job descriptions (open roles) for this agency with client, priority and openings.",
    inputSchema: z.object({
      status: z.enum(["any", "open", "on_hold", "closed", "filled"]).default("open"),
      limit: z.number().min(1).max(30).default(15),
    }),
    async execute({ status, limit }) {
      const rows = await db
        .select({
          id: schema.jobDescriptions.id,
          title: schema.jobDescriptions.title,
          status: schema.jobDescriptions.status,
          priority: schema.jobDescriptions.priority,
          location: schema.jobDescriptions.location,
          openings: schema.jobDescriptions.openings,
          skills: schema.jobDescriptions.skillsRequired,
          clientName: schema.clients.companyName,
        })
        .from(schema.jobDescriptions)
        .leftJoin(schema.clients, eq(schema.clients.id, schema.jobDescriptions.clientId))
        .where(
          and(
            eq(schema.jobDescriptions.agencyId, agencyId),
            status === "any" ? undefined : eq(schema.jobDescriptions.status, status),
          ),
        )
        .limit(limit);
      return { count: rows.length, jobs: rows };
    },
  });

  const topMatchesForJob = tool({
    description:
      "Get the ranked shortlist for a job description. Expired match scores are excluded from the ranking and reported separately — they must be re-run before they can be used.",
    inputSchema: z.object({
      jdId: z.string().describe("Job description id from listJobs"),
      limit: z.number().min(1).max(25).default(10),
    }),
    async execute({ jdId, limit }) {
      const rows = await db
        .select({ match: schema.cvJdMatches, candidate: schema.candidates })
        .from(schema.cvJdMatches)
        .innerJoin(schema.candidates, eq(schema.candidates.id, schema.cvJdMatches.candidateId))
        .where(and(eq(schema.cvJdMatches.agencyId, agencyId), eq(schema.cvJdMatches.jdId, jdId)))
        .orderBy(desc(schema.cvJdMatches.matchScore))
        .limit(200);

      const ranked = rows.filter((r) => !isExpired(r.match.expiresAt));
      const expired = rows.filter((r) => isExpired(r.match.expiresAt));

      return {
        ranked: ranked.slice(0, limit).map((r) => ({
          candidateId: r.candidate.id,
          name: fullName(r.candidate),
          matchScore: Math.round(r.match.matchScore * 10) / 10,
          shortlisted: r.match.isShortlisted,
          skillsMatched: r.match.skillsMatched ?? [],
          skillsMissing: r.match.skillsMissing ?? [],
          status: r.candidate.currentStatus,
        })),
        expiredCount: expired.length,
        expiredCandidates: expired.slice(0, 10).map((r) => ({
          candidateId: r.candidate.id,
          name: fullName(r.candidate),
          note: "Score expired — re-run match before using",
        })),
      };
    },
  });

  const candidateProfile = tool({
    description:
      "Full profile for one candidate: parsed CV data, match scores, HR screening, AI interview qualitative assessment, technical scores and final score.",
    inputSchema: z.object({ candidateId: z.string() }),
    async execute({ candidateId }) {
      const [c] = await db
        .select()
        .from(schema.candidates)
        .where(and(eq(schema.candidates.id, candidateId), eq(schema.candidates.agencyId, agencyId)))
        .limit(1);
      if (!c) return { error: "Candidate not found in this workspace" };

      const settings = await getSettings(agencyId);
      const [matches, hr, ai, tech] = await Promise.all([
        db.select().from(schema.cvJdMatches).where(eq(schema.cvJdMatches.candidateId, candidateId)),
        db.select().from(schema.interviewsHr).where(eq(schema.interviewsHr.candidateId, candidateId)),
        db.select().from(schema.interviewsAi).where(eq(schema.interviewsAi.candidateId, candidateId)),
        db
          .select()
          .from(schema.interviewsTechnical)
          .where(eq(schema.interviewsTechnical.candidateId, candidateId))
          .orderBy(desc(schema.interviewsTechnical.conductedAt)),
      ]);

      const bestMatch = matches
        .filter((m) => !isExpired(m.expiresAt))
        .sort((a, b) => b.matchScore - a.matchScore)[0];
      const latestTech = tech[0];

      return {
        id: c.id,
        name: fullName(c),
        email: c.email,
        location: c.location,
        headline: c.headline,
        experienceYears: c.experienceYears,
        skills: c.skillsExtracted ?? [],
        technologies: c.technologies ?? [],
        education: c.education ?? [],
        certifications: c.certifications ?? [],
        status: c.currentStatus,
        stage: c.currentStage,
        tags: c.tags ?? [],
        matchScore: bestMatch ? Math.round(bestMatch.matchScore * 10) / 10 : null,
        expiredMatchCount: matches.filter((m) => isExpired(m.expiresAt)).length,
        hrScreening: hr.map((h) => ({
          result: h.result,
          communicationScore: h.communicationScore,
          salaryExpectation: h.salaryExpectation,
          noticePeriod: h.noticePeriod,
          notes: h.overallNotes,
        })),
        aiInterview: ai.map((a) => ({
          status: a.status,
          summary: a.aiSummary,
          strengths: a.strengths ?? [],
          weaknesses: a.weaknesses ?? [],
          suggestedTechFocus: a.suggestedTechFocus ?? [],
          note: "Qualitative only — never counted in the numeric ranking",
        })),
        technicalScore: latestTech?.totalScore ?? null,
        recommendation: latestTech?.recommendation ?? null,
        finalScore: finalScore(bestMatch?.matchScore ?? null, latestTech?.totalScore ?? null, settings),
        scoringFormula: `final = match × ${settings.matchWeight} + technical × ${settings.techWeight}`,
      };
    },
  });

  const pipelineStats = tool({
    description:
      "Pipeline and hiring health: candidate counts by status, open roles, interviews pending, placements, expiring match scores.",
    inputSchema: z.object({}),
    async execute() {
      const settings = await getSettings(agencyId);
      const soon = new Date(Date.now() + 7 * 86_400_000);
      const [byStatus, jobs, hrPending, aiPending, techDone, placed, expiring, expired] = await Promise.all([
        db
          .select({ status: schema.candidates.currentStatus, n: sql<number>`count(*)` })
          .from(schema.candidates)
          .where(eq(schema.candidates.agencyId, agencyId))
          .groupBy(schema.candidates.currentStatus),
        db
          .select({ status: schema.jobDescriptions.status, n: sql<number>`count(*)` })
          .from(schema.jobDescriptions)
          .where(eq(schema.jobDescriptions.agencyId, agencyId))
          .groupBy(schema.jobDescriptions.status),
        db
          .select({ n: sql<number>`count(*)` })
          .from(schema.candidates)
          .where(and(eq(schema.candidates.agencyId, agencyId), eq(schema.candidates.currentStage, "hr_screening"))),
        db
          .select({ n: sql<number>`count(*)` })
          .from(schema.interviewsAi)
          .where(and(eq(schema.interviewsAi.agencyId, agencyId), inArray(schema.interviewsAi.status, ["pending", "invited"]))),
        db
          .select({ n: sql<number>`count(*)`, avg: sql<number>`avg(total_score)` })
          .from(schema.interviewsTechnical)
          .where(eq(schema.interviewsTechnical.agencyId, agencyId)),
        db
          .select({ n: sql<number>`count(*)` })
          .from(schema.placements)
          .where(eq(schema.placements.agencyId, agencyId)),
        db
          .select({ n: sql<number>`count(*)` })
          .from(schema.cvJdMatches)
          .where(
            and(
              eq(schema.cvJdMatches.agencyId, agencyId),
              gt(schema.cvJdMatches.expiresAt, new Date()),
              sql`${schema.cvJdMatches.expiresAt} <= ${soon.getTime()}`,
            ),
          ),
        db
          .select({ n: sql<number>`count(*)` })
          .from(schema.cvJdMatches)
          .where(and(eq(schema.cvJdMatches.agencyId, agencyId), sql`${schema.cvJdMatches.expiresAt} <= ${Date.now()}`)),
      ]);

      return {
        candidatesByStatus: Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)])),
        jobsByStatus: Object.fromEntries(jobs.map((r) => [r.status, Number(r.n)])),
        hrScreeningQueue: Number(hrPending[0]?.n ?? 0),
        aiInterviewsPending: Number(aiPending[0]?.n ?? 0),
        technicalInterviewsCompleted: Number(techDone[0]?.n ?? 0),
        averageTechnicalScore: techDone[0]?.avg ? Math.round(Number(techDone[0].avg) * 10) / 10 : null,
        placements: Number(placed[0]?.n ?? 0),
        matchScoresExpiringWithin7Days: Number(expiring[0]?.n ?? 0),
        matchScoresAlreadyExpired: Number(expired[0]?.n ?? 0),
        scoreExpiryDays: settings.scoreExpiryDays,
      };
    },
  });

  const placementHistory = tool({
    description: "Recent placements (hired candidates) with client, role, salary, final score and time to hire.",
    inputSchema: z.object({ limit: z.number().min(1).max(30).default(10) }),
    async execute({ limit }) {
      const rows = await db
        .select()
        .from(schema.placements)
        .where(eq(schema.placements.agencyId, agencyId))
        .orderBy(desc(schema.placements.placedAt))
        .limit(limit);
      return {
        count: rows.length,
        placements: rows.map((p) => ({
          candidate: p.candidateName,
          role: p.positionTitle,
          client: p.clientName,
          salary: p.offeredSalary,
          finalScore: p.finalScore,
          timeToHireDays: p.timeToHireDays,
          recruiter: p.recruiterName,
          placedAt: p.placedAt,
          status: p.status,
        })),
      };
    },
  });

  const skillGapAnalysis = tool({
    description:
      "Aggregate the most frequently missing skills across the shortlist of a job description — tells you where the talent pool is weak.",
    inputSchema: z.object({ jdId: z.string() }),
    async execute({ jdId }) {
      const rows = await db
        .select()
        .from(schema.cvJdMatches)
        .where(and(eq(schema.cvJdMatches.agencyId, agencyId), eq(schema.cvJdMatches.jdId, jdId)));
      const live = rows.filter((r) => !isExpired(r.expiresAt));
      const counts = new Map<string, number>();
      for (const r of live) for (const s of r.skillsMissing ?? []) counts.set(s, (counts.get(s) ?? 0) + 1);
      const gaps = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([skill, missingIn]) => ({ skill, missingIn, ofCandidates: live.length }));
      return { analysed: live.length, excludedExpired: rows.length - live.length, gaps };
    },
  });

  return new ToolLoopAgent({
    model: gateway(REASON_MODEL),
    instructions: [
      {
        role: "system",
        content: dedent`
          You are the Skillton AI Recruiter Copilot, embedded in a recruitment
          agency's hiring platform. You are talking to ${userName}, a recruiter.

          Your job: answer questions about this agency's candidates, jobs,
          pipeline and placements using the tools — never invent data. Always
          call a tool before making a factual claim about candidates or roles.

          Rules you must respect:
          - Match scores expire after the agency's score-expiry window (60 days
            by default). Expired scores are hidden, excluded from all ranking,
            and must be re-run. If expired rows are relevant, say so explicitly
            and tell the recruiter to re-run the match.
          - The AI voice interview is QUALITATIVE ONLY. Never treat it as a
            number and never include it in a ranking or final score.
          - The final candidate score is match × 0.20 + technical × 0.80.
          - Never fabricate candidate names, scores, emails or salaries.

          Formatting — the UI renders your markdown, so use it deliberately:
          - Open with a one-line direct answer in bold. No preamble.
          - Use a "### Heading" to separate sections when the answer has more
            than one part. Never more than three sections.
          - Rankings, comparisons and anything with more than two attributes go
            in a markdown table with a header row. Keep tables under six columns.
          - Reasoning and observations go in "- " bullets, one idea each.
          - Sequential recommendations go in a numbered list.
          - Write scores as "82/100" and rates as "64%" — the UI highlights them
            automatically. Bold candidate, client and role names.
          - Close with a "> " blockquote holding the single next action, when
            there is a clear one.
          - Never wrap the whole answer in a code block, and never pad with
            filler sentences.
        `,
      },
    ],
    tools: {
      searchCandidates,
      listJobs,
      topMatchesForJob,
      candidateProfile,
      pipelineStats,
      placementHistory,
      skillGapAnalysis,
    },
    stopWhen: [stepCountIs(12)],
  });
}
