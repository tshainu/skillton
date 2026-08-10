import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { db } from "../database";
import * as schema from "../database/schema";
import { newId } from "../lib/ids";
import { BUCKETS } from "../lib/buckets";
import { audit, authed, getSettings, notify, timeline } from "../middleware/auth";
import { ensurePlacement } from "../lib/placement";

/**
 * Talent pools — recruitment buckets, flagged candidates awaiting a client
 * decision, hidden gems and the blacklist. All four views read the same
 * candidate rows, only the filter differs.
 */

const bucketEnum = z.enum(BUCKETS);
const outcomeEnum = z.enum(["placed", "hold", "rejected"]);

function fullName(c: { firstName: string; lastName: string | null }) {
  return `${c.firstName} ${c.lastName ?? ""}`.trim();
}

/** Latest technical score per candidate, for the whole agency. */
async function techScores(agencyId: string) {
  const rows = await db
    .select({
      candidateId: schema.interviewsTechnical.candidateId,
      score: schema.interviewsTechnical.totalScore,
      recommendation: schema.interviewsTechnical.recommendation,
      conductedAt: schema.interviewsTechnical.conductedAt,
    })
    .from(schema.interviewsTechnical)
    .where(eq(schema.interviewsTechnical.agencyId, agencyId))
    .orderBy(desc(schema.interviewsTechnical.conductedAt));
  const map = new Map<string, { score: number; recommendation: string }>();
  for (const r of rows) {
    if (!map.has(r.candidateId)) map.set(r.candidateId, { score: r.score, recommendation: r.recommendation });
  }
  return map;
}

/**
 * Latest AI interview read per candidate: the average of the six assessment
 * dimensions on a 0-10 scale, plus the flags that came with it. Recruiters
 * reviewing a flagged candidate need this next to the technical score — it is
 * often the only evidence of how the candidate actually presented.
 */
async function aiScores(agencyId: string) {
  const rows = await db
    .select({
      candidateId: schema.interviewsAi.candidateId,
      status: schema.interviewsAi.status,
      assessment: schema.interviewsAi.assessment,
      conductedAt: schema.interviewsAi.conductedAt,
      fraudFlags: schema.interviewsAi.fraudFlags,
      positiveSignals: schema.interviewsAi.positiveSignals,
    })
    .from(schema.interviewsAi)
    .where(eq(schema.interviewsAi.agencyId, agencyId))
    .orderBy(desc(schema.interviewsAi.conductedAt));

  const map = new Map<
    string,
    { score: number | null; status: string; flags: string[]; confident: boolean }
  >();
  for (const r of rows) {
    if (map.has(r.candidateId)) continue;
    const a = r.assessment;
    const score = a
      ? Math.round(
          ((a.communication +
            a.confidence +
            a.knowledge +
            a.professionalism +
            a.criticalThinking +
            a.responseConsistency) /
            6) *
            10,
        ) / 10
      : null;
    map.set(r.candidateId, {
      score,
      status: r.status,
      flags: r.fraudFlags ?? [],
      confident: (r.positiveSignals ?? []).includes("strong_eye_contact"),
    });
  }
  return map;
}

/** Best live match score per candidate. */
async function matchScores(agencyId: string) {
  const rows = await db
    .select({
      candidateId: schema.cvJdMatches.candidateId,
      score: sql<number>`max(${schema.cvJdMatches.matchScore})`,
    })
    .from(schema.cvJdMatches)
    .where(eq(schema.cvJdMatches.agencyId, agencyId))
    .groupBy(schema.cvJdMatches.candidateId);
  return new Map(rows.map((r) => [r.candidateId, Number(r.score)]));
}

export const talent = {
  /** Candidates in one bucket (or all of them, grouped). */
  byBucket: authed
    .input(z.object({ bucket: bucketEnum.optional() }).optional())
    .handler(async ({ input, context }) => {
      const where = [eq(schema.candidates.agencyId, context.agencyId)];
      if (input?.bucket) where.push(eq(schema.candidates.bucket, input.bucket));
      else where.push(sql`${schema.candidates.bucket} is not null`);

      const rows = await db
        .select()
        .from(schema.candidates)
        .where(and(...where))
        .orderBy(desc(schema.candidates.bucketSetAt));

      const [tech, match] = await Promise.all([techScores(context.agencyId), matchScores(context.agencyId)]);

      const counts: Record<string, number> = {};
      for (const b of BUCKETS) counts[b] = 0;

      const list = rows.map((c) => {
        if (c.bucket) counts[c.bucket] = (counts[c.bucket] ?? 0) + 1;
        return {
          id: c.id,
          name: fullName(c),
          nic: c.nic,
          phone: c.phone,
          email: c.email,
          headline: c.headline,
          location: c.location,
          experienceYears: c.experienceYears,
          source: c.source,
          bucket: c.bucket,
          bucketReason: c.bucketReason,
          bucketSetAt: c.bucketSetAt,
          stage: c.currentStage,
          status: c.currentStatus,
          clientFailCount: c.clientFailCount,
          techScore: tech.get(c.id)?.score ?? null,
          matchScore: match.get(c.id) ?? null,
        };
      });

      return { counts, rows: list };
    }),

  /** Manually move a candidate between buckets — HR override. */
  setBucket: authed
    .input(
      z.object({
        candidateId: z.string(),
        bucket: bucketEnum.nullable(),
        reason: z.string().max(500).optional(),
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
      if (!candidate) throw new ORPCError("NOT_FOUND", { message: "Candidate not found" });

      await db
        .update(schema.candidates)
        .set({
          bucket: input.bucket,
          bucketReason: input.reason ?? null,
          bucketSetAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.candidates.id, input.candidateId));

      await timeline(
        context.agencyId,
        input.candidateId,
        "bucket",
        input.bucket ? `Moved to ${input.bucket} bucket` : "Removed from bucket",
        input.reason,
        context.user.name,
      );
      await audit(context.user, "talent.bucket", "candidate", input.candidateId, {
        bucket: input.bucket,
        reason: input.reason,
      });
      return { ok: true };
    }),

  /** Bulk bucket assignment straight from the HR screening list. */
  setBucketBulk: authed
    .input(
      z.object({
        candidateIds: z.array(z.string()).min(1).max(200),
        bucket: bucketEnum,
        reason: z.string().max(500).optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      await db
        .update(schema.candidates)
        .set({
          bucket: input.bucket,
          bucketReason: input.reason ?? null,
          bucketSetAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.candidates.agencyId, context.agencyId),
            inArray(schema.candidates.id, input.candidateIds),
          ),
        );
      await audit(context.user, "talent.bucket_bulk", "candidate", undefined, {
        count: input.candidateIds.length,
        bucket: input.bucket,
      });
      return { updated: input.candidateIds.length };
    }),

  /**
   * Flagged candidates — selected at the technical stage and waiting on the
   * client-side interview decision.
   */
  flagged: authed.handler(async ({ context }) => {
    const rows = await db
      .select()
      .from(schema.candidates)
      .where(
        and(eq(schema.candidates.agencyId, context.agencyId), eq(schema.candidates.isFlagged, true)),
      )
      .orderBy(desc(schema.candidates.updatedAt));

    const [tech, match, ai] = await Promise.all([
      techScores(context.agencyId),
      matchScores(context.agencyId),
      aiScores(context.agencyId),
    ]);
    const settings = await getSettings(context.agencyId);

    const ids = rows.map((r) => r.id);
    const interviews = ids.length
      ? await db
          .select()
          .from(schema.clientInterviews)
          .where(inArray(schema.clientInterviews.candidateId, ids))
          .orderBy(desc(schema.clientInterviews.createdAt))
      : [];
    const lastByCandidate = new Map<string, (typeof interviews)[number]>();
    for (const i of interviews) if (!lastByCandidate.has(i.candidateId)) lastByCandidate.set(i.candidateId, i);

    return {
      failLimit: settings.clientFailLimit,
      rows: rows.map((c) => {
        const t = tech.get(c.id);
        const m = match.get(c.id) ?? null;
        return {
          id: c.id,
          name: fullName(c),
          nic: c.nic,
          phone: c.phone,
          email: c.email,
          headline: c.headline,
          bucket: c.bucket,
          stage: c.currentStage,
          status: c.currentStatus,
          clientOutcome: c.clientOutcome,
          clientFailCount: c.clientFailCount,
          techScore: t?.score ?? null,
          recommendation: t?.recommendation ?? null,
          matchScore: m,
          aiScore: ai.get(c.id)?.score ?? null,
          aiStatus: ai.get(c.id)?.status ?? null,
          aiFlags: ai.get(c.id)?.flags ?? [],
          aiConfident: ai.get(c.id)?.confident ?? false,
          finalScore:
            t?.score != null
              ? Math.round(((m ?? 0) * settings.matchWeight + t.score * settings.techWeight) * 10) / 10
              : null,
          lastFeedback: lastByCandidate.get(c.id)?.feedback ?? null,
          lastOutcomeAt: lastByCandidate.get(c.id)?.createdAt ?? null,
        };
      }),
    };
  }),

  /**
   * Record the client-side interview outcome.
   *
   * placed   -> hired, flag cleared, placement recorded upstream
   * hold     -> stays flagged
   * rejected -> fail counter +1; purple tag when the technical score cleared the
   *             bar; at the configured fail limit the candidate is removed from
   *             the active system (blacklisted with an automatic reason).
   */
  setClientOutcome: authed
    .input(
      z.object({
        candidateId: z.string(),
        outcome: outcomeEnum,
        feedback: z.string().max(2000).optional(),
        clientId: z.string().optional(),
        jdId: z.string().optional(),
      }),
    )
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

      await db.insert(schema.clientInterviews).values({
        id: newId("cli"),
        agencyId: context.agencyId,
        candidateId: candidate.id,
        jdId: input.jdId ?? null,
        clientId: input.clientId ?? null,
        outcome: input.outcome,
        feedback: input.feedback ?? null,
        recordedBy: context.user.name,
      });

      const tech = (await techScores(context.agencyId)).get(candidate.id)?.score ?? null;
      const patch: Partial<typeof schema.candidates.$inferInsert> = {
        clientOutcome: input.outcome,
        updatedAt: new Date(),
      };
      let removed = false;

      if (input.outcome === "placed") {
        patch.isFlagged = false;
        patch.currentStatus = "hired";
        patch.currentStage = "decision";
      } else if (input.outcome === "rejected") {
        const fails = candidate.clientFailCount + 1;
        patch.clientFailCount = fails;
        /* A recorded rejection is a closed decision — the candidate leaves the
           flagged queue and lives on in Hidden Gems / the bucket views. */
        patch.isFlagged = false;
        if (tech != null && tech >= settings.purpleTagMinTechScore) {
          patch.bucket = "purple";
          patch.bucketReason = `Technical ${tech}/100 but rejected at client interview`;
          patch.bucketSetAt = new Date();
        }
        if (fails >= settings.clientFailLimit) {
          removed = true;
          patch.isFlagged = false;
          patch.isBlacklisted = true;
          patch.blacklistedAt = new Date();
          patch.blacklistedBy = context.user.name;
          patch.blacklistReason = `Failed ${fails} client interviews`;
          patch.currentStatus = "blacklisted";
        }
      }

      await db.update(schema.candidates).set(patch).where(eq(schema.candidates.id, candidate.id));

      /* A client interview recorded as "placed" IS a placement. Without this the
         candidate showed as hired everywhere while the Placed page, the placement
         report and the dashboard's hired numbers stayed empty. */
      let placed: Awaited<ReturnType<typeof ensurePlacement>> | null = null;
      if (input.outcome === "placed") {
        placed = await ensurePlacement({
          agencyId: context.agencyId,
          candidateId: candidate.id,
          jdId: input.jdId ?? null,
          clientId: input.clientId ?? null,
          recruiterId: context.user.id,
          recruiterName: context.user.name,
          notes: input.feedback ?? "Placed at client interview.",
        });
        if (placed.created) {
          await db
            .update(schema.candidates)
            .set({ retentionPolicy: "hired_permanent", deletionScheduledAt: null })
            .where(eq(schema.candidates.id, candidate.id));
          await notify(
            context.agencyId,
            "Candidate placed",
            `${fullName(candidate)} was placed${placed.clientName ? ` at ${placed.clientName}` : ""} as ${placed.positionTitle}.`,
            "success",
            "/placed",
          );
        }
      }

      await timeline(
        context.agencyId,
        candidate.id,
        "client_interview",
        `Client interview: ${input.outcome}`,
        input.feedback,
        context.user.name,
      );
      if (removed) {
        await notify(
          context.agencyId,
          "Candidate removed",
          `${fullName(candidate)} reached ${settings.clientFailLimit} failed client interviews and was removed from the active pool.`,
          "warning",
          `/candidates/${candidate.id}`,
        );
      }
      await audit(context.user, "talent.client_outcome", "candidate", candidate.id, {
        outcome: input.outcome,
        removed,
      });

      return {
        ok: true,
        removed,
        bucket: patch.bucket ?? candidate.bucket,
        placementId: placed?.placementId ?? null,
      };
    }),

  /**
   * Hidden gems — good candidates lost at a single stage, grouped into tabs:
   * AI-interview passers, technical passers, and client-interview rejects.
   */
  hiddenGems: authed.handler(async ({ context }) => {
    const settings = await getSettings(context.agencyId);
    const rows = await db
      .select()
      .from(schema.candidates)
      .where(
        and(eq(schema.candidates.agencyId, context.agencyId), eq(schema.candidates.isBlacklisted, false)),
      );

    const [tech, match] = await Promise.all([techScores(context.agencyId), matchScores(context.agencyId)]);

    const ai = await db
      .select({
        candidateId: schema.interviewsAi.candidateId,
        status: schema.interviewsAi.status,
        assessment: schema.interviewsAi.assessment,
        summary: schema.interviewsAi.aiSummary,
      })
      .from(schema.interviewsAi)
      .where(
        and(
          eq(schema.interviewsAi.agencyId, context.agencyId),
          eq(schema.interviewsAi.status, "completed"),
        ),
      );
    const aiByCandidate = new Map(ai.map((a) => [a.candidateId, a]));

    const decorate = (c: (typeof rows)[number], tag: string, reason: string) => ({
      id: c.id,
      name: fullName(c),
      nic: c.nic,
      phone: c.phone,
      email: c.email,
      headline: c.headline,
      location: c.location,
      experienceYears: c.experienceYears,
      skills: (c.skillsExtracted ?? []).slice(0, 8),
      bucket: c.bucket,
      tag,
      reason,
      stage: c.currentStage,
      status: c.currentStatus,
      matchScore: match.get(c.id) ?? null,
      techScore: tech.get(c.id)?.score ?? null,
      clientFailCount: c.clientFailCount,
    });

    const aiPassed: ReturnType<typeof decorate>[] = [];
    const techPassed: ReturnType<typeof decorate>[] = [];
    const clientFailed: ReturnType<typeof decorate>[] = [];

    for (const c of rows) {
      const t = tech.get(c.id);
      const m = match.get(c.id) ?? 0;
      const hasAi = aiByCandidate.has(c.id);

      /* Blue — cleared the AI interview above the match bar, failed technical. */
      if (
        hasAi &&
        m >= settings.blueTagMinAiMatch &&
        t != null &&
        (t.recommendation === "reject" || t.score < settings.purpleTagMinTechScore)
      ) {
        aiPassed.push(
          decorate(c, "blue", `AI interview passed at ${Math.round(m)}% match, technical ${t.score}/100`),
        );
        continue;
      }
      /* Purple — cleared technical, rejected by the client. */
      if (t != null && t.score >= settings.purpleTagMinTechScore && c.clientOutcome === "rejected") {
        clientFailed.push(
          decorate(c, "purple", `Technical ${t.score}/100, rejected at client interview`),
        );
        continue;
      }
      /* Strong technical, still unplaced. */
      if (t != null && t.score >= settings.purpleTagMinTechScore && c.currentStatus !== "hired") {
        techPassed.push(decorate(c, "green", `Technical ${t.score}/100, awaiting placement`));
      }
    }

    return {
      thresholds: {
        blueTagMinAiMatch: settings.blueTagMinAiMatch,
        purpleTagMinTechScore: settings.purpleTagMinTechScore,
        clientFailLimit: settings.clientFailLimit,
      },
      aiPassed,
      techPassed,
      clientFailed,
      total: aiPassed.length + techPassed.length + clientFailed.length,
    };
  }),

  /** Blacklist tab on the candidates page. */
  blacklist: authed.handler(async ({ context }) => {
    const rows = await db
      .select()
      .from(schema.candidates)
      .where(
        and(eq(schema.candidates.agencyId, context.agencyId), eq(schema.candidates.isBlacklisted, true)),
      )
      .orderBy(desc(schema.candidates.blacklistedAt));

    const reasons = await db
      .select()
      .from(schema.blacklistReasons)
      .where(
        and(
          eq(schema.blacklistReasons.agencyId, context.agencyId),
          eq(schema.blacklistReasons.isActive, true),
        ),
      );

    return {
      reasons: reasons.map((r) => r.label),
      rows: rows.map((c) => ({
        id: c.id,
        name: fullName(c),
        nic: c.nic,
        phone: c.phone,
        email: c.email,
        headline: c.headline,
        reason: c.blacklistReason,
        blacklistedAt: c.blacklistedAt,
        blacklistedBy: c.blacklistedBy,
        clientFailCount: c.clientFailCount,
      })),
    };
  }),

  setBlacklisted: authed
    .input(
      z.object({
        candidateId: z.string(),
        blacklisted: z.boolean(),
        reason: z.string().max(300).optional(),
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
      if (!candidate) throw new ORPCError("NOT_FOUND", { message: "Candidate not found" });

      if (input.blacklisted && !input.reason) {
        throw new ORPCError("BAD_REQUEST", { message: "A reason is required to blacklist a candidate" });
      }

      await db
        .update(schema.candidates)
        .set({
          isBlacklisted: input.blacklisted,
          blacklistReason: input.blacklisted ? (input.reason ?? null) : null,
          blacklistedAt: input.blacklisted ? new Date() : null,
          blacklistedBy: input.blacklisted ? context.user.name : null,
          currentStatus: input.blacklisted ? "blacklisted" : "new",
          isFlagged: input.blacklisted ? false : candidate.isFlagged,
          updatedAt: new Date(),
        })
        .where(eq(schema.candidates.id, input.candidateId));

      await timeline(
        context.agencyId,
        input.candidateId,
        "blacklist",
        input.blacklisted ? "Blacklisted" : "Restored from blacklist",
        input.reason,
        context.user.name,
      );
      await audit(
        context.user,
        input.blacklisted ? "candidate.blacklisted" : "candidate.restored",
        "candidate",
        input.candidateId,
        { reason: input.reason },
      );
      return { ok: true };
    }),
};
