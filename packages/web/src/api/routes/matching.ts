import { z } from "zod";
import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { db } from "../database";
import * as schema from "../database/schema";
import { newId } from "../lib/ids";
import { embed } from "../lib/embeddings";
import { isExpired, daysUntilExpiry } from "../lib/scoring";
import {
  buildMatch,
  explainInBackground,
  explainMatches,
  persistMatches,
  poolFilter,
  type MatchInsert,
} from "../lib/match-engine";
import { audit, authed, getSettings, notify, timeline } from "../middleware/auth";

export const matching = {
  /**
   * Run the matching engine for a JD against every parsed candidate.
   * AI explanations are generated only for the top `explainTop` scorers to keep
   * the run fast and cheap.
   */
  runForJob: authed
    .input(
      z.object({
        jdId: z.string(),
        explainTop: z.number().min(0).max(30).default(10),
        onlyMissing: z.boolean().default(false),
      }),
    )
    .handler(async ({ input, context }) => {
      const startedAt = Date.now();
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

      /* A JD that was never vectorised used to return nothing at all. Embed it
         on the fly instead so the run always produces a ranking. */
      if (!job.jdVector) {
        const text = [job.title, job.jdText, (job.skillsRequired ?? []).join(", ")]
          .filter(Boolean)
          .join("\n");
        if (!text.trim()) {
          throw new ORPCError("BAD_REQUEST", {
            message: "This JD has no text or skills yet — upload or paste the job description first",
          });
        }
        job.jdVector = await embed(text);
        await db
          .update(schema.jobDescriptions)
          .set({ jdVector: job.jdVector })
          .where(eq(schema.jobDescriptions.id, job.id));
      }

      const pool = await db.select().from(schema.candidates).where(poolFilter(context.agencyId));
      if (!pool.length) return { scored: 0, shortlisted: 0, ms: Date.now() - startedAt, results: [] };

      let existingIds = new Set<string>();
      if (input.onlyMissing) {
        const rows = await db
          .select({ candidateId: schema.cvJdMatches.candidateId, expiresAt: schema.cvJdMatches.expiresAt })
          .from(schema.cvJdMatches)
          .where(eq(schema.cvJdMatches.jdId, input.jdId));
        existingIds = new Set(rows.filter((r) => !isExpired(r.expiresAt)).map((r) => r.candidateId));
      }

      const targets = pool.filter((c) => !existingIds.has(c.id));
      const opts = { threshold: settings.shortlistThreshold, expiryDays: settings.scoreExpiryDays };

      /* Pass 1 — deterministic scoring for the whole pool, entirely in memory. */
      const built = targets.map((candidate) => buildMatch(context.agencyId, job, candidate, opts));

      /* One batched write for everything — scores are available immediately. */
      const ranked = [...built].sort((a, b) => b.score - a.score);
      await persistMatches(built.map((b) => b.values));

      /* AI narrative for the top scorers runs after the response and patches
         the saved rows, so the ranking never waits on the model. */
      explainInBackground(ranked.slice(0, input.explainTop));

      /* Promote shortlisted candidates still sitting at "new" — also batched. */
      const shortlisted = built.filter((b) => b.score >= settings.shortlistThreshold);
      const promote = shortlisted.filter((b) => b.candidate.currentStatus === "new");
      if (promote.length) {
        await db
          .update(schema.candidates)
          .set({ currentStatus: "shortlisted", updatedAt: new Date() })
          .where(inArray(schema.candidates.id, promote.map((b) => b.candidate.id)));
        await db.insert(schema.candidateEvents).values(
          promote.map((b) => ({
            id: newId("evt"),
            agencyId: context.agencyId,
            candidateId: b.candidate.id,
            kind: "match",
            title: `Shortlisted for ${job.title}`,
            detail: `Match score ${b.score}/100`,
            actorName: "AI Matching Engine",
          })),
        );
      }

      await notify(
        context.agencyId,
        "Matching complete",
        `${job.title}: ${built.length} CVs scored, ${shortlisted.length} shortlisted (threshold ${settings.shortlistThreshold}).`,
        "success",
        `/jobs/${job.id}`,
      );
      await audit(context.user, "matching.run", "job_description", job.id, {
        scored: built.length,
        shortlisted: shortlisted.length,
        ms: Date.now() - startedAt,
      });

      return {
        scored: built.length,
        shortlisted: shortlisted.length,
        ms: Date.now() - startedAt,
        results: ranked.slice(0, Math.max(input.explainTop, 20)).map((b) => ({
          candidateId: b.candidate.id,
          name: `${b.candidate.firstName} ${b.candidate.lastName ?? ""}`.trim(),
          score: b.score,
          shortlisted: b.values.isShortlisted ?? false,
        })),
      };
    }),

  /** Score one candidate against every open JD (used from the candidate page). */
  runForCandidate: authed
    .input(z.object({ candidateId: z.string() }))
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
        if (!text.trim()) {
          throw new ORPCError("BAD_REQUEST", { message: "Parse the CV before running a match" });
        }
        candidate.cvVector = await embed(text);
        await db
          .update(schema.candidates)
          .set({ cvVector: candidate.cvVector })
          .where(eq(schema.candidates.id, candidate.id));
      }

      const openJobs = await db
        .select()
        .from(schema.jobDescriptions)
        .where(
          and(
            eq(schema.jobDescriptions.agencyId, context.agencyId),
            eq(schema.jobDescriptions.status, "open"),
          ),
        );

      const opts = { threshold: settings.shortlistThreshold, expiryDays: settings.scoreExpiryDays };
      const built = openJobs.map((job) => buildMatch(context.agencyId, job, candidate, opts));
      const ranked = [...built].sort((a, b) => b.score - a.score);
      await persistMatches(built.map((b) => b.values));
      explainInBackground(ranked.slice(0, 8));

      await timeline(
        context.agencyId,
        candidate.id,
        "match",
        `Matched against ${built.length} open jobs`,
        built.length ? `Best: ${ranked[0]!.score}/100` : undefined,
        context.user.name,
      );

      return {
        scored: built.length,
        results: ranked.map((b) => ({ jdId: b.job.id, title: b.job.title, score: b.score })),
      };
    }),

  /** Re-run a single expired (or stale) match — the "Score expired" CTA. */
  rerun: authed
    .input(z.object({ candidateId: z.string(), jdId: z.string() }))
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
      if (!job || !candidate) throw new ORPCError("NOT_FOUND");

      const built = buildMatch(context.agencyId, job, candidate, {
        threshold: settings.shortlistThreshold,
        expiryDays: settings.scoreExpiryDays,
      });
      await explainMatches([built]);
      await persistMatches([built.values]);
      await audit(context.user, "matching.rerun", "candidate", candidate.id, { jdId: job.id });
      return {
        score: built.score,
        shortlisted: built.values.isShortlisted ?? false,
        expiryDays: settings.scoreExpiryDays,
      };
    }),

  /** Bulk re-run of everything that has expired. */
  rerunExpired: authed
    .input(z.object({ limit: z.number().min(1).max(200).default(50) }).optional())
    .handler(async ({ input, context }) => {
      const settings = await getSettings(context.agencyId);
      const stale = await db
        .select()
        .from(schema.cvJdMatches)
        .where(
          and(
            eq(schema.cvJdMatches.agencyId, context.agencyId),
            lte(schema.cvJdMatches.expiresAt, new Date()),
          ),
        )
        .limit(input?.limit ?? 50);
      if (!stale.length) return { found: 0, refreshed: 0 };

      /* Load every job and candidate involved in two queries, not 2N. */
      const jobRows = await db
        .select()
        .from(schema.jobDescriptions)
        .where(inArray(schema.jobDescriptions.id, [...new Set(stale.map((r) => r.jdId))]));
      const candidateRows = await db
        .select()
        .from(schema.candidates)
        .where(inArray(schema.candidates.id, [...new Set(stale.map((r) => r.candidateId))]));

      const jobsById = new Map(jobRows.map((j) => [j.id, j]));
      const candidatesById = new Map(candidateRows.map((c) => [c.id, c]));

      const rows: MatchInsert[] = [];
      for (const row of stale) {
        const job = jobsById.get(row.jdId);
        const candidate = candidatesById.get(row.candidateId);
        if (!job || !candidate) continue;
        rows.push(
          buildMatch(context.agencyId, job, candidate, {
            threshold: settings.shortlistThreshold,
            expiryDays: settings.scoreExpiryDays,
          }).values,
        );
      }
      await persistMatches(rows);
      return { found: stale.length, refreshed: rows.length };
    }),

  toggleShortlist: authed
    .input(z.object({ matchId: z.string(), isShortlisted: z.boolean() }))
    .handler(async ({ input, context }) => {
      await db
        .update(schema.cvJdMatches)
        .set({ isShortlisted: input.isShortlisted, updatedAt: new Date() })
        .where(
          and(eq(schema.cvJdMatches.id, input.matchId), eq(schema.cvJdMatches.agencyId, context.agencyId)),
        );
      return { ok: true };
    }),

  /** Expiry overview for the Matching page. */
  expiryOverview: authed.handler(async ({ context }) => {
    const settings = await getSettings(context.agencyId);
    const now = new Date();
    const soon = new Date(now.getTime() + 7 * 86_400_000);

    const [stats] = await db
      .select({
        total: sql<number>`count(*)`,
        live: sql<number>`sum(case when ${schema.cvJdMatches.expiresAt} > ${now.getTime()} then 1 else 0 end)`,
        expired: sql<number>`sum(case when ${schema.cvJdMatches.expiresAt} <= ${now.getTime()} then 1 else 0 end)`,
        expiringSoon: sql<number>`sum(case when ${schema.cvJdMatches.expiresAt} > ${now.getTime()} and ${schema.cvJdMatches.expiresAt} <= ${soon.getTime()} then 1 else 0 end)`,
        shortlisted: sql<number>`sum(case when ${schema.cvJdMatches.expiresAt} > ${now.getTime()} and ${schema.cvJdMatches.isShortlisted} = 1 then 1 else 0 end)`,
      })
      .from(schema.cvJdMatches)
      .where(eq(schema.cvJdMatches.agencyId, context.agencyId));

    const expiringRows = await db
      .select({
        match: schema.cvJdMatches,
        candidateName: sql<string>`${schema.candidates.firstName} || ' ' || coalesce(${schema.candidates.lastName}, '')`,
        jobTitle: schema.jobDescriptions.title,
      })
      .from(schema.cvJdMatches)
      .innerJoin(schema.candidates, eq(schema.candidates.id, schema.cvJdMatches.candidateId))
      .innerJoin(schema.jobDescriptions, eq(schema.jobDescriptions.id, schema.cvJdMatches.jdId))
      .where(eq(schema.cvJdMatches.agencyId, context.agencyId))
      .orderBy(schema.cvJdMatches.expiresAt)
      .limit(60);

    return {
      expiryDays: settings.scoreExpiryDays,
      threshold: settings.shortlistThreshold,
      total: Number(stats?.total ?? 0),
      live: Number(stats?.live ?? 0),
      expired: Number(stats?.expired ?? 0),
      expiringSoon: Number(stats?.expiringSoon ?? 0),
      shortlisted: Number(stats?.shortlisted ?? 0),
      rows: expiringRows.map((r) => {
        const expired = isExpired(r.match.expiresAt, now);
        return {
          matchId: r.match.id,
          candidateId: r.match.candidateId,
          jdId: r.match.jdId,
          candidateName: r.candidateName.trim(),
          jobTitle: r.jobTitle,
          score: expired ? null : Math.round(r.match.matchScore * 10) / 10,
          expired,
          daysLeft: daysUntilExpiry(r.match.expiresAt, now),
          matchedAt: r.match.matchedAt,
          expiresAt: r.match.expiresAt,
        };
      }),
    };
  }),

  /** Global search across live (non-expired) matches. */
  search: authed
    .input(
      z.object({
        skill: z.string().optional(),
        minScore: z.number().min(0).max(100).default(0),
        jdId: z.string().optional(),
        stage: z.string().optional(),
        limit: z.number().min(1).max(200).default(60),
      }),
    )
    .handler(async ({ input, context }) => {
      const where = [
        eq(schema.cvJdMatches.agencyId, context.agencyId),
        sql`${schema.cvJdMatches.expiresAt} > ${Date.now()}`,
        sql`${schema.cvJdMatches.matchScore} >= ${input.minScore}`,
      ];
      if (input.jdId) where.push(eq(schema.cvJdMatches.jdId, input.jdId));
      if (input.stage) where.push(eq(schema.candidates.currentStage, input.stage));
      /* "Cisco, Juniper" means both — recruiters type a comma-separated shopping
         list and expect every term to be present, not a loose OR. */
      const terms = (input.skill ?? "")
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      for (const term of terms) {
        const q = `%${term}%`;
        where.push(
          sql`(lower(${schema.candidates.skillsExtracted}) like ${q} or lower(${schema.candidates.technologies}) like ${q})`,
        );
      }

      const rows = await db
        .select({
          match: schema.cvJdMatches,
          candidateId: schema.candidates.id,
          candidateName: sql<string>`${schema.candidates.firstName} || ' ' || coalesce(${schema.candidates.lastName}, '')`,
          headline: schema.candidates.headline,
          stage: schema.candidates.currentStage,
          status: schema.candidates.currentStatus,
          experienceYears: schema.candidates.experienceYears,
          jobTitle: schema.jobDescriptions.title,
          jdId: schema.jobDescriptions.id,
        })
        .from(schema.cvJdMatches)
        .innerJoin(schema.candidates, eq(schema.candidates.id, schema.cvJdMatches.candidateId))
        .innerJoin(schema.jobDescriptions, eq(schema.jobDescriptions.id, schema.cvJdMatches.jdId))
        .where(and(...where))
        .orderBy(desc(schema.cvJdMatches.matchScore))
        .limit(input.limit);

      return rows.map((r) => ({
        matchId: r.match.id,
        candidateId: r.candidateId,
        candidateName: r.candidateName.trim(),
        headline: r.headline,
        stage: r.stage,
        status: r.status,
        experienceYears: r.experienceYears,
        jobTitle: r.jobTitle,
        jdId: r.jdId,
        score: Math.round(r.match.matchScore * 10) / 10,
        skillsMatched: r.match.skillsMatched,
        skillsMissing: r.match.skillsMissing,
        aiExplanation: r.match.aiExplanation,
        daysLeft: daysUntilExpiry(r.match.expiresAt),
      }));
    }),
};
