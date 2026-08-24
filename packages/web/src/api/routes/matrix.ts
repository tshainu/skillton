import { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { db } from "../database";
import * as schema from "../database/schema";
import { embed } from "../lib/embeddings";
import { buildMatch, persistMatches, poolFilter } from "../lib/match-engine";
import { resolveSkillClasses } from "../lib/skill-class";
import { audit, authed, getSettings, timeline } from "../middleware/auth";

/**
 * JD <-> CV matrix.
 *
 * Both directions score in memory against the live pool and return the top N,
 * so the page answers instantly and never depends on a previous engine run.
 * Results are persisted afterwards so the rest of the app sees the same scores.
 */

const TOP_N = 10;

function fullName(c: { firstName: string; lastName: string | null }) {
  return `${c.firstName} ${c.lastName ?? ""}`.trim();
}

export const matrix = {
  /** Every JD with its client name — the searchable dropdown on the JD tab. */
  jdOptions: authed.handler(async ({ context }) => {
    const rows = await db
      .select({
        id: schema.jobDescriptions.id,
        title: schema.jobDescriptions.title,
        status: schema.jobDescriptions.status,
        location: schema.jobDescriptions.location,
        openings: schema.jobDescriptions.openings,
        clientName: schema.clients.companyName,
      })
      .from(schema.jobDescriptions)
      .leftJoin(schema.clients, eq(schema.clients.id, schema.jobDescriptions.clientId))
      .where(eq(schema.jobDescriptions.agencyId, context.agencyId))
      .orderBy(schema.jobDescriptions.title);

    return rows.map((r) => ({
      ...r,
      label: r.clientName ? `${r.title} — ${r.clientName}` : r.title,
      search: [r.title, r.clientName, r.location].filter(Boolean).join(" ").toLowerCase(),
    }));
  }),

  /** Candidate dropdown for the CV tab — searchable by name, NIC and phone. */
  candidateOptions: authed
    .input(z.object({ query: z.string().default(""), limit: z.number().min(1).max(200).default(60) }))
    .handler(async ({ input, context }) => {
      const where = [eq(schema.candidates.agencyId, context.agencyId)];
      const q = input.query.trim().toLowerCase();
      if (q) {
        const like = `%${q}%`;
        where.push(
          sql`(lower(${schema.candidates.firstName}) like ${like}
            or lower(coalesce(${schema.candidates.lastName}, '')) like ${like}
            or lower(coalesce(${schema.candidates.nic}, '')) like ${like}
            or lower(coalesce(${schema.candidates.phone}, '')) like ${like}
            or lower(coalesce(${schema.candidates.email}, '')) like ${like})`,
        );
      }
      const rows = await db
        .select({
          id: schema.candidates.id,
          firstName: schema.candidates.firstName,
          lastName: schema.candidates.lastName,
          nic: schema.candidates.nic,
          phone: schema.candidates.phone,
          headline: schema.candidates.headline,
          bucket: schema.candidates.bucket,
        })
        .from(schema.candidates)
        .where(and(...where))
        .orderBy(schema.candidates.firstName)
        .limit(input.limit);

      return rows.map((r) => ({
        id: r.id,
        name: fullName(r),
        nic: r.nic,
        phone: r.phone,
        headline: r.headline,
        bucket: r.bucket,
        label: [fullName(r), r.nic, r.phone].filter(Boolean).join(" · "),
      }));
    }),

  /** JD -> CV: best-suited candidates for one job. */
  candidatesForJd: authed
    .input(z.object({ jdId: z.string(), top: z.number().min(1).max(50).default(TOP_N) }))
    .handler(async ({ input, context }) => {
      const settings = await getSettings(context.agencyId);
      const [job] = await db
        .select()
        .from(schema.jobDescriptions)
        .where(
          and(
            eq(schema.jobDescriptions.id, input.jdId),
            eq(schema.jobDescriptions.agencyId, context.agencyId),
          ),
        )
        .limit(1);
      if (!job) throw new ORPCError("NOT_FOUND", { message: "Job not found" });

      if (!job.jdVector) {
        const text = [job.title, job.jdText, (job.skillsRequired ?? []).join(", ")]
          .filter(Boolean)
          .join("\n");
        if (text.trim()) {
          job.jdVector = await embed(text);
          await db
            .update(schema.jobDescriptions)
            .set({ jdVector: job.jdVector })
            .where(eq(schema.jobDescriptions.id, job.id));
        }
      }

      const pool = await db.select().from(schema.candidates).where(poolFilter(context.agencyId));
      /* Soft skills and role context are excluded from scoring — resolved once
         for the whole pool so the ranking costs no extra round trips. */
      const classes = await resolveSkillClasses([
        ...(job.parsed?.skills ?? job.skillsRequired ?? []),
        ...(job.parsed?.technologies ?? []),
        ...pool.flatMap((c) => [...(c.skillsExtracted ?? []), ...(c.technologies ?? [])]),
      ]);
      const built = pool
        .map((candidate) =>
          buildMatch(context.agencyId, job, candidate, {
            threshold: settings.shortlistThreshold,
            expiryDays: settings.scoreExpiryDays,
            classes,
          }),
        )
        .sort((a, b) => b.score - a.score);

      const top = built.slice(0, input.top);
      await persistMatches(top.map((b) => b.values));

      /* Which of these are already sitting in the HR screening queue? */
      const ids = top.map((b) => b.candidate.id);
      const screened = ids.length
        ? await db
            .select({ candidateId: schema.interviewsHr.candidateId })
            .from(schema.interviewsHr)
            .where(inArray(schema.interviewsHr.candidateId, ids))
        : [];
      const screenedIds = new Set(screened.map((s) => s.candidateId));

      return {
        job: {
          id: job.id,
          title: job.title,
          location: job.location,
          skillsRequired: job.parsed?.skills ?? job.skillsRequired ?? [],
        },
        poolSize: pool.length,
        rows: top.map((b) => ({
          candidateId: b.candidate.id,
          name: fullName(b.candidate),
          nic: b.candidate.nic,
          phone: b.candidate.phone,
          headline: b.candidate.headline,
          experienceYears: b.candidate.experienceYears,
          location: b.candidate.location,
          bucket: b.candidate.bucket,
          stage: b.candidate.currentStage,
          status: b.candidate.currentStatus,
          score: b.score,
          skillsMatched: b.skills.matched,
          skillsMissing: b.skills.missing,
          alreadyScreened: screenedIds.has(b.candidate.id),
        })),
      };
    }),

  /** CV -> JD: best-matching jobs for one candidate. */
  jdsForCandidate: authed
    .input(z.object({ candidateId: z.string(), top: z.number().min(1).max(50).default(TOP_N) }))
    .handler(async ({ input, context }) => {
      const settings = await getSettings(context.agencyId);
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
      if (!candidate) throw new ORPCError("NOT_FOUND", { message: "Candidate not found" });

      if (!candidate.cvVector) {
        const text = [candidate.headline, candidate.cvText, (candidate.skillsExtracted ?? []).join(", ")]
          .filter(Boolean)
          .join("\n");
        if (text.trim()) {
          candidate.cvVector = await embed(text);
          await db
            .update(schema.candidates)
            .set({ cvVector: candidate.cvVector })
            .where(eq(schema.candidates.id, candidate.id));
        }
      }

      const jobs = await db
        .select()
        .from(schema.jobDescriptions)
        .where(eq(schema.jobDescriptions.agencyId, context.agencyId));

      const clientRows = await db
        .select({ id: schema.clients.id, companyName: schema.clients.companyName })
        .from(schema.clients)
        .where(eq(schema.clients.agencyId, context.agencyId));
      const clientName = new Map(clientRows.map((c) => [c.id, c.companyName]));

      const classes = await resolveSkillClasses([
        ...jobs.flatMap((j) => [
          ...(j.parsed?.skills ?? j.skillsRequired ?? []),
          ...(j.parsed?.technologies ?? []),
        ]),
        ...(candidate.skillsExtracted ?? []),
        ...(candidate.technologies ?? []),
      ]);
      const built = jobs
        .map((job) =>
          buildMatch(context.agencyId, job, candidate, {
            threshold: settings.shortlistThreshold,
            expiryDays: settings.scoreExpiryDays,
            classes,
          }),
        )
        .sort((a, b) => b.score - a.score);

      const top = built.slice(0, input.top);
      await persistMatches(top.map((b) => b.values));

      return {
        candidate: {
          id: candidate.id,
          name: fullName(candidate),
          nic: candidate.nic,
          phone: candidate.phone,
          headline: candidate.headline,
          experienceYears: candidate.experienceYears,
          skills: candidate.skillsExtracted ?? [],
        },
        poolSize: jobs.length,
        rows: top.map((b) => ({
          jdId: b.job.id,
          title: b.job.title,
          clientName: b.job.clientId ? (clientName.get(b.job.clientId) ?? null) : null,
          location: b.job.location,
          status: b.job.status,
          openings: b.job.openings,
          score: b.score,
          skillsMatched: b.skills.matched,
          skillsMissing: b.skills.missing,
        })),
      };
    }),

  /**
   * Push checked candidates into the HR screening queue. Creates a pending HR
   * screening row for each so they appear on the screening page.
   */
  sendToScreening: authed
    .input(z.object({ candidateIds: z.array(z.string()).min(1).max(100), jdId: z.string().optional() }))
    .handler(async ({ input, context }) => {
      const rows = await db
        .select()
        .from(schema.candidates)
        .where(
          and(
            eq(schema.candidates.agencyId, context.agencyId),
            inArray(schema.candidates.id, input.candidateIds),
          ),
        );
      if (!rows.length) throw new ORPCError("NOT_FOUND", { message: "No matching candidates" });

      /* No HR interview row is created here — the screening record is written
         when the recruiter actually submits the form. Writing a placeholder
         "hold" result made every candidate look screened-and-parked. */
      await db
        .update(schema.candidates)
        .set({
          currentStatus: "hr_screening",
          currentStage: "screening",
          updatedAt: new Date(),
        })
        .where(inArray(schema.candidates.id, rows.map((c) => c.id)));

      for (const c of rows) {
        await timeline(
          context.agencyId,
          c.id,
          "screening",
          "Sent to HR screening",
          "Selected from the JD CV Matrix",
          context.user.name,
        );
      }

      await audit(context.user, "matrix.send_to_screening", "candidate", undefined, {
        count: rows.length,
        jdId: input.jdId,
      });
      return { queued: rows.length, alreadyQueued: 0 };
    }),
};
