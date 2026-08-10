import { z } from "zod";
import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { db } from "../database";
import * as schema from "../database/schema";
import { newId } from "../lib/ids";
import { extractFromKey } from "../lib/extract";
import { parseCv } from "../lib/ai-extract";
import { embed } from "../lib/embeddings";
import { audit, authed, notify, timeline } from "../middleware/auth";
import { isExpired, daysUntilExpiry } from "../lib/scoring";
import { formatMoney, normalizeCurrency } from "../lib/currency";
import { allocateCidBlock } from "../lib/cid";
import { ensurePlacement } from "../lib/placement";

const CANDIDATE_STATUSES = [
  "new","shortlisted","hr_screening","hr_selected","hr_hold","hr_rejected",
  "ai_interview_pending","ai_interview_completed","tech_interview_pending",
  "tech_interview_completed","final_review","offered","hired","rejected","blacklisted",
] as const;

const STAGES = ["screening", "ai_interview", "tech_interview", "client_review", "decision"] as const;

/** Extract text, AI-parse and embed one uploaded CV. */
async function ingestCv(candidateId: string) {
  const [candidate] = await db
    .select()
    .from(schema.candidates)
    .where(eq(schema.candidates.id, candidateId))
    .limit(1);
  if (!candidate?.cvFilePath) return;

  try {
    const text = await extractFromKey(candidate.cvFilePath, candidate.cvFileName ?? "cv.pdf");
    if (!text.trim()) throw new Error("No readable text in document");

    const parsed = await parseCv(text, candidate.cvFileName ?? "cv.pdf");
    const vector = await embed(text);

    await db
      .update(schema.candidates)
      .set({
        firstName: parsed.firstName || candidate.firstName,
        lastName: parsed.lastName ?? candidate.lastName,
        email: parsed.email ?? candidate.email,
        phone: parsed.phone ?? candidate.phone,
        location: parsed.location,
        headline: parsed.headline,
        experienceYears: parsed.experienceYears,
        skillsExtracted: parsed.skills,
        technologies: parsed.technologies,
        education: parsed.education,
        certifications: parsed.certifications,
        languages: parsed.languages,
        projects: parsed.projects,
        cvText: text,
        cvVector: vector,
        parseStatus: "parsed",
        parseError: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.candidates.id, candidateId));

    /* Duplicate detection. Phone, NIC and email are the identity fields — the
       recruiter is told exactly which of them collided so they can accept or
       reject the CV instead of guessing. */
    const identity: { field: string; value: string | null | undefined }[] = [
      { field: "phone", value: parsed.phone ?? candidate.phone },
      { field: "nic", value: parsed.nic ?? candidate.nic },
      { field: "email", value: parsed.email ?? candidate.email },
    ];
    const normalise = (value: string) => value.toLowerCase().replace(/[\s-]/g, "");

    const others = await db
      .select({
        id: schema.candidates.id,
        phone: schema.candidates.phone,
        nic: schema.candidates.nic,
        email: schema.candidates.email,
      })
      .from(schema.candidates)
      .where(
        and(
          eq(schema.candidates.agencyId, candidate.agencyId),
          sql`${schema.candidates.id} != ${candidateId}`,
          sql`${schema.candidates.isDuplicateOf} is null`,
        ),
      );

    let bestMatchId: string | null = null;
    let collided: string[] = [];
    for (const other of others) {
      const hits = identity
        .filter((entry) => {
          if (!entry.value) return false;
          const theirs = other[entry.field as "phone" | "nic" | "email"];
          return Boolean(theirs) && normalise(theirs as string) === normalise(entry.value);
        })
        .map((entry) => entry.field);
      if (hits.length > collided.length) {
        collided = hits;
        bestMatchId = other.id;
      }
    }

    if (bestMatchId && collided.length) {
      await db
        .update(schema.candidates)
        .set({
          isDuplicateOf: bestMatchId,
          duplicateFields: collided,
          duplicateDecision: "pending",
          tags: ["duplicate"],
        })
        .where(eq(schema.candidates.id, candidateId));
    }
  } catch (error) {
    await db
      .update(schema.candidates)
      .set({ parseStatus: "failed", parseError: (error as Error).message.slice(0, 300) })
      .where(eq(schema.candidates.id, candidateId));
  }
}

export const candidates = {
  /** Resume library with filters. Expired scores are never surfaced as numbers. */
  list: authed
    .input(
      z
        .object({
          search: z.string().optional(),
          status: z.enum(CANDIDATE_STATUSES).optional(),
          stage: z.enum(STAGES).optional(),
          skill: z.string().optional(),
          bucket: z.string().optional(),
          /** all (default) | active | blacklisted */
          scope: z.enum(["all", "active", "blacklisted"]).default("active"),
          minExperience: z.number().optional(),
          limit: z.number().min(1).max(500).default(200),
        })
        .optional(),
    )
    .handler(async ({ input, context }) => {
      const where = [eq(schema.candidates.agencyId, context.agencyId)];
      if (input?.status) where.push(eq(schema.candidates.currentStatus, input.status));
      if (input?.stage) where.push(eq(schema.candidates.currentStage, input.stage));
      if (input?.bucket) where.push(eq(schema.candidates.bucket, input.bucket));
      if (input?.scope === "blacklisted") where.push(eq(schema.candidates.isBlacklisted, true));
      else if (input?.scope !== "all") where.push(eq(schema.candidates.isBlacklisted, false));
      if (input?.search) {
        const q = `%${input.search.toLowerCase()}%`;
        where.push(
          or(
            like(sql`lower(${schema.candidates.firstName})`, q),
            like(sql`lower(${schema.candidates.lastName})`, q),
            like(sql`lower(${schema.candidates.email})`, q),
            like(sql`lower(${schema.candidates.cid})`, q),
            like(sql`lower(${schema.candidates.nic})`, q),
            like(sql`lower(${schema.candidates.phone})`, q),
            like(sql`replace(replace(coalesce(${schema.candidates.phone}, ''), ' ', ''), '-', '')`, q.replace(/[\s-]/g, "")),
            like(sql`lower(${schema.candidates.headline})`, q),
            like(sql`lower(${schema.candidates.cvText})`, q),
          )!,
        );
      }
      if (input?.skill) {
        const q = `%${input.skill.toLowerCase()}%`;
        where.push(
          or(
            like(sql`lower(${schema.candidates.skillsExtracted})`, q),
            like(sql`lower(${schema.candidates.technologies})`, q),
          )!,
        );
      }
      if (input?.minExperience != null) {
        where.push(sql`coalesce(${schema.candidates.experienceYears}, 0) >= ${input.minExperience}`);
      }

      const rows = await db
        .select({
          id: schema.candidates.id,
          cid: schema.candidates.cid,
          firstName: schema.candidates.firstName,
          lastName: schema.candidates.lastName,
          email: schema.candidates.email,
          phone: schema.candidates.phone,
          nic: schema.candidates.nic,
          source: schema.candidates.source,
          location: schema.candidates.location,
          headline: schema.candidates.headline,
          bucket: schema.candidates.bucket,
          bucketReason: schema.candidates.bucketReason,
          isBlacklisted: schema.candidates.isBlacklisted,
          blacklistReason: schema.candidates.blacklistReason,
          isFlagged: schema.candidates.isFlagged,
          clientOutcome: schema.candidates.clientOutcome,
          experienceYears: schema.candidates.experienceYears,
          currentStatus: schema.candidates.currentStatus,
          currentStage: schema.candidates.currentStage,
          tags: schema.candidates.tags,
          skillsExtracted: schema.candidates.skillsExtracted,
          technologies: schema.candidates.technologies,
          parseStatus: schema.candidates.parseStatus,
          parseError: schema.candidates.parseError,
          isDuplicateOf: schema.candidates.isDuplicateOf,
          duplicateFields: schema.candidates.duplicateFields,
          duplicateDecision: schema.candidates.duplicateDecision,
          cvFileName: schema.candidates.cvFileName,
          cvFilePath: schema.candidates.cvFilePath,
          createdAt: schema.candidates.createdAt,
        })
        .from(schema.candidates)
        .where(and(...where))
        .orderBy(desc(schema.candidates.createdAt))
        .limit(input?.limit ?? 200);

      if (!rows.length) return [];

      const now = new Date();
      const best = await db
        .select({
          candidateId: schema.cvJdMatches.candidateId,
          best: sql<number>`max(case when ${schema.cvJdMatches.expiresAt} > ${now.getTime()} then ${schema.cvJdMatches.matchScore} else null end)`,
          total: sql<number>`count(*)`,
          live: sql<number>`sum(case when ${schema.cvJdMatches.expiresAt} > ${now.getTime()} then 1 else 0 end)`,
        })
        .from(schema.cvJdMatches)
        .where(inArray(schema.cvJdMatches.candidateId, rows.map((r) => r.id)))
        .groupBy(schema.cvJdMatches.candidateId);

      return rows.map((row) => {
        const stats = best.find((b) => b.candidateId === row.id);
        const hasMatches = Number(stats?.total ?? 0) > 0;
        const liveCount = Number(stats?.live ?? 0);
        return {
          ...row,
          bestScore: stats?.best != null ? Math.round(Number(stats.best) * 10) / 10 : null,
          matchCount: liveCount,
          /** true when the candidate has matches but every one of them has expired */
          scoreExpired: hasMatches && liveCount === 0,
        };
      });
    }),

  get: authed.input(z.object({ id: z.string() })).handler(async ({ input, context }) => {
    const [candidate] = await db
      .select()
      .from(schema.candidates)
      .where(and(eq(schema.candidates.id, input.id), eq(schema.candidates.agencyId, context.agencyId)))
      .limit(1);
    if (!candidate) throw new ORPCError("NOT_FOUND", { message: "Candidate not found" });

    const events = await db
      .select()
      .from(schema.candidateEvents)
      .where(eq(schema.candidateEvents.candidateId, input.id))
      .orderBy(desc(schema.candidateEvents.createdAt));

    const hr = await db
      .select()
      .from(schema.interviewsHr)
      .where(eq(schema.interviewsHr.candidateId, input.id))
      .orderBy(desc(schema.interviewsHr.conductedAt));

    const ai = await db
      .select()
      .from(schema.interviewsAi)
      .where(eq(schema.interviewsAi.candidateId, input.id))
      .orderBy(desc(schema.interviewsAi.invitedAt));

    const tech = await db
      .select()
      .from(schema.interviewsTechnical)
      .where(eq(schema.interviewsTechnical.candidateId, input.id))
      .orderBy(desc(schema.interviewsTechnical.conductedAt));

    const [placement] = await db
      .select()
      .from(schema.placements)
      .where(eq(schema.placements.candidateId, input.id))
      .limit(1);

    return {
      candidate: { ...candidate, cvVector: null },
      events,
      hrInterviews: hr,
      aiInterviews: ai,
      techInterviews: tech,
      placement: placement ?? null,
    };
  }),

  /**
   * View 2 — Candidate View: best matching job descriptions.
   * Expired rows keep the candidate visible but return `score: null`.
   */
  matches: authed.input(z.object({ candidateId: z.string() })).handler(async ({ input, context }) => {
    const rows = await db
      .select({
        match: schema.cvJdMatches,
        job: {
          id: schema.jobDescriptions.id,
          title: schema.jobDescriptions.title,
          status: schema.jobDescriptions.status,
          priority: schema.jobDescriptions.priority,
          location: schema.jobDescriptions.location,
          clientId: schema.jobDescriptions.clientId,
        },
      })
      .from(schema.cvJdMatches)
      .innerJoin(schema.jobDescriptions, eq(schema.jobDescriptions.id, schema.cvJdMatches.jdId))
      .where(
        and(
          eq(schema.cvJdMatches.candidateId, input.candidateId),
          eq(schema.cvJdMatches.agencyId, context.agencyId),
        ),
      )
      .orderBy(desc(schema.cvJdMatches.matchScore));

    const clientRows = await db
      .select({ id: schema.clients.id, companyName: schema.clients.companyName })
      .from(schema.clients)
      .where(eq(schema.clients.agencyId, context.agencyId));

    const now = new Date();
    return rows.map((row) => {
      const expired = isExpired(row.match.expiresAt, now);
      return {
        job: {
          ...row.job,
          clientName: clientRows.find((c) => c.id === row.job.clientId)?.companyName ?? null,
        },
        expired,
        daysLeft: daysUntilExpiry(row.match.expiresAt, now),
        score: expired ? null : Math.round(row.match.matchScore * 10) / 10,
        matchId: row.match.id,
        isShortlisted: row.match.isShortlisted,
        skillsMatched: row.match.skillsMatched,
        skillsMissing: row.match.skillsMissing,
        aiExplanation: expired ? null : row.match.aiExplanation,
        recommendedFocusAreas: row.match.recommendedFocusAreas,
        matchedAt: row.match.matchedAt,
        expiresAt: row.match.expiresAt,
      };
    });
  }),

  /** Register uploaded CV files. Returns immediately; parsing runs per file. */
  bulkUpload: authed
    .input(
      z.object({
        files: z.array(z.object({ key: z.string(), filename: z.string() })).min(1).max(50),
      }),
    )
    .handler(async ({ input, context }) => {
      /* Every candidate gets a human-facing CID the recruiters can search by. */
      const cids = await allocateCidBlock(context.agencyId, input.files.length);
      const rows = input.files.map((file, index) => ({
          id: newId("cnd"),
          agencyId: context.agencyId,
          cid: cids[index] ?? null,
          firstName: file.filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 60),
          cvFilePath: file.key,
          cvFileName: file.filename,
          parseStatus: "pending",
          createdBy: context.user.id,
      }));
      const created = await db
        .insert(schema.candidates)
        .values(rows)
        .returning({ id: schema.candidates.id });

      await audit(context.user, "cv.bulk_uploaded", "candidate", undefined, { count: created.length });
      return { ids: created.map((c) => c.id) };
    }),

  /** Parse one uploaded CV. The client calls this per id so progress is visible. */
  parse: authed.input(z.object({ id: z.string() })).handler(async ({ input, context }) => {
    const [candidate] = await db
      .select({ id: schema.candidates.id })
      .from(schema.candidates)
      .where(and(eq(schema.candidates.id, input.id), eq(schema.candidates.agencyId, context.agencyId)))
      .limit(1);
    if (!candidate) throw new ORPCError("NOT_FOUND");
    await ingestCv(input.id);
    const [row] = await db
      .select({
        id: schema.candidates.id,
        firstName: schema.candidates.firstName,
        lastName: schema.candidates.lastName,
        parseStatus: schema.candidates.parseStatus,
        parseError: schema.candidates.parseError,
        isDuplicateOf: schema.candidates.isDuplicateOf,
      })
      .from(schema.candidates)
      .where(eq(schema.candidates.id, input.id))
      .limit(1);
    return row!;
  }),

  setStatus: authed
    .input(
      z.object({
        id: z.string(),
        status: z.enum(CANDIDATE_STATUSES),
        stage: z.enum(STAGES).optional(),
        note: z.string().optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const [row] = await db
        .update(schema.candidates)
        .set({
          currentStatus: input.status,
          ...(input.stage ? { currentStage: input.stage } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(schema.candidates.id, input.id), eq(schema.candidates.agencyId, context.agencyId)))
        .returning({ id: schema.candidates.id, firstName: schema.candidates.firstName });
      if (!row) throw new ORPCError("NOT_FOUND");
      await timeline(
        context.agencyId,
        input.id,
        "status",
        `Status → ${input.status.replace(/_/g, " ")}`,
        input.note,
        context.user.name,
      );
      await audit(context.user, "candidate.status_changed", "candidate", input.id, input);
      return { ok: true };
    }),

  /** Edit the identity fields the parser cannot reliably read. */
  updateDetails: authed
    .input(
      z.object({
        id: z.string(),
        firstName: z.string().min(1).max(80).optional(),
        lastName: z.string().max(80).nullable().optional(),
        email: z.string().email().nullable().optional(),
        phone: z.string().max(40).nullable().optional(),
        nic: z.string().max(30).nullable().optional(),
        location: z.string().max(120).nullable().optional(),
        headline: z.string().max(200).nullable().optional(),
        source: z
          .enum([
            "website",
            "linkedin",
            "referral",
            "job_portal",
            "facebook",
            "manual",
            "university",
            "database",
          ])
          .optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const { id, ...rest } = input;
      const patch = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
      if (!Object.keys(patch).length) return { ok: true };

      const [row] = await db
        .update(schema.candidates)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(schema.candidates.id, id), eq(schema.candidates.agencyId, context.agencyId)))
        .returning({ id: schema.candidates.id });
      if (!row) throw new ORPCError("NOT_FOUND");

      await audit(context.user, "candidate.details_updated", "candidate", id, patch);
      return { ok: true };
    }),

  setTags: authed
    .input(z.object({ id: z.string(), tags: z.array(z.string()) }))
    .handler(async ({ input, context }) => {
      await db
        .update(schema.candidates)
        .set({ tags: input.tags, updatedAt: new Date() })
        .where(and(eq(schema.candidates.id, input.id), eq(schema.candidates.agencyId, context.agencyId)));
      return { ok: true };
    }),

  blacklist: authed
    .input(z.object({ id: z.string(), reason: z.string() }))
    .handler(async ({ input, context }) => {
      await db
        .update(schema.candidates)
        .set({
          currentStatus: "blacklisted",
          blacklistReason: input.reason,
          tags: ["blacklisted"],
          updatedAt: new Date(),
        })
        .where(and(eq(schema.candidates.id, input.id), eq(schema.candidates.agencyId, context.agencyId)));
      await timeline(context.agencyId, input.id, "blacklist", "Blacklisted", input.reason, context.user.name);
      await audit(context.user, "candidate.blacklisted", "candidate", input.id, input);
      return { ok: true };
    }),

  restore: authed.input(z.object({ id: z.string() })).handler(async ({ input, context }) => {
    await db
      .update(schema.candidates)
      .set({ currentStatus: "new", currentStage: "screening", blacklistReason: null, tags: [], updatedAt: new Date() })
      .where(and(eq(schema.candidates.id, input.id), eq(schema.candidates.agencyId, context.agencyId)));
    await timeline(context.agencyId, input.id, "restore", "Restored to pipeline", undefined, context.user.name);
    return { ok: true };
  }),

  /** Mark hired — creates the permanent placement record shown on the Placed page. */
  markHired: authed
    .input(
      z.object({
        id: z.string(),
        jdId: z.string().optional(),
        offeredSalary: z.string().optional(),
        salaryCurrency: z.string().max(3).optional(),
        offeredSalaryAmount: z.number().nonnegative().optional(),
        startDate: z.string().optional(),
        notes: z.string().optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const [candidate] = await db
        .select()
        .from(schema.candidates)
        .where(and(eq(schema.candidates.id, input.id), eq(schema.candidates.agencyId, context.agencyId)))
        .limit(1);
      if (!candidate) throw new ORPCError("NOT_FOUND", { message: "Candidate not found" });

      const placement = await ensurePlacement({
        agencyId: context.agencyId,
        candidateId: input.id,
        jdId: input.jdId ?? null,
        recruiterId: context.user.id,
        recruiterName: context.user.name,
        offeredSalary: input.offeredSalary,
        offeredSalaryAmount: input.offeredSalaryAmount ?? null,
        salaryCurrency: input.salaryCurrency,
        startDate: input.startDate ? new Date(input.startDate) : null,
        notes: input.notes,
      });
      if (!placement.created) throw new ORPCError("CONFLICT", { message: "Candidate is already placed" });
      const placementId = placement.placementId;

      /* Hired candidates are retained permanently (legal requirement). */
      await db
        .update(schema.candidates)
        .set({
          currentStatus: "hired",
          currentStage: "decision",
          retentionPolicy: "hired_permanent",
          deletionScheduledAt: null,
          tags: ["hired"],
          updatedAt: new Date(),
        })
        .where(eq(schema.candidates.id, input.id));

      await timeline(
        context.agencyId,
        input.id,
        "hired",
        `Hired — ${placement.positionTitle}`,
        input.notes,
        context.user.name,
      );
      await notify(
        context.agencyId,
        "Candidate placed",
        `${candidate.firstName} ${candidate.lastName ?? ""} was hired for ${placement.positionTitle}.`,
        "success",
        "/placed",
      );
      await audit(context.user, "candidate.hired", "candidate", input.id, { placementId });

      return { placementId };
    }),

  remove: authed.input(z.object({ id: z.string() })).handler(async ({ input, context }) => {
    await db.delete(schema.cvJdMatches).where(eq(schema.cvJdMatches.candidateId, input.id));
    await db.delete(schema.candidateEvents).where(eq(schema.candidateEvents.candidateId, input.id));
    await db
      .delete(schema.candidates)
      .where(and(eq(schema.candidates.id, input.id), eq(schema.candidates.agencyId, context.agencyId)));
    await audit(context.user, "candidate.deleted", "candidate", input.id);
    return { ok: true };
  }),
};
