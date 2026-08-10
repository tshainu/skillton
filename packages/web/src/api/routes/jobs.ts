import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { db } from "../database";
import * as schema from "../database/schema";
import { newId } from "../lib/ids";
import { extractFromKey } from "../lib/extract";
import { parseJd } from "../lib/ai-extract";
import { embed } from "../lib/embeddings";
import { audit, authed, timeline } from "../middleware/auth";
import { isExpired } from "../lib/scoring";
import { formatSalaryRange, SALARY_PERIODS } from "../lib/currency";

const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
const STATUSES = ["open", "on_hold", "closed", "filled"] as const;

const jobInput = z.object({
  title: z.string().min(1),
  clientId: z.string().optional(),
  department: z.string().optional(),
  location: z.string().optional(),
  employmentType: z.string().optional(),
  experienceLevel: z.string().optional(),
  /** Display cache, always derived from the structured fields below. */
  salaryRange: z.string().optional(),
  salaryCurrency: z.string().max(3).optional(),
  salaryMin: z.number().nonnegative().optional(),
  salaryMax: z.number().nonnegative().optional(),
  salaryPeriod: z.enum(SALARY_PERIODS).optional(),
  priority: z.enum(PRIORITIES).default("medium"),
  openings: z.number().min(1).default(1),
  /** Tigris key of the uploaded JD document — the only source used by matching. */
  jdFilePath: z.string().optional(),
  jdFileName: z.string().optional(),
  /** Pasted JD text, used when no document is uploaded. */
  jdText: z.string().optional(),
});

/** Human-readable salary label kept in sync with the structured columns. */
function salaryDisplay(input: {
  salaryRange?: string;
  salaryCurrency?: string;
  salaryMin?: number;
  salaryMax?: number;
  salaryPeriod?: string;
}): string | undefined {
  if (input.salaryMin == null && input.salaryMax == null) return input.salaryRange;
  return formatSalaryRange({
    currency: input.salaryCurrency,
    min: input.salaryMin,
    max: input.salaryMax,
    period: input.salaryPeriod,
    fallback: input.salaryRange,
  });
}

/** Extract, parse and embed a JD document. Runs inline (JDs are created one at a time). */
async function ingestJd(jobId: string, title: string) {
  const [job] = await db
    .select()
    .from(schema.jobDescriptions)
    .where(eq(schema.jobDescriptions.id, jobId))
    .limit(1);
  if (!job) return;

  let text = job.jdText ?? "";
  if (job.jdFilePath) {
    try {
      text = await extractFromKey(job.jdFilePath, job.jdFileName ?? "jd.pdf");
    } catch {
      /* keep pasted text if the document could not be read */
    }
  }
  if (!text.trim()) return;

  const parsed = await parseJd(text, title);
  const skills = [...new Set([...(parsed.skills ?? []), ...(parsed.technologies ?? [])])];
  const vector = await embed(`${title}\n${text}`);

  await db
    .update(schema.jobDescriptions)
    .set({ jdText: text, parsed, skillsRequired: skills, jdVector: vector })
    .where(eq(schema.jobDescriptions.id, jobId));
}

export const jobs = {
  list: authed
    .input(z.object({ status: z.enum(STATUSES).optional(), clientId: z.string().optional() }).optional())
    .handler(async ({ input, context }) => {
      const where = [eq(schema.jobDescriptions.agencyId, context.agencyId)];
      if (input?.status) where.push(eq(schema.jobDescriptions.status, input.status));
      if (input?.clientId) where.push(eq(schema.jobDescriptions.clientId, input.clientId));

      const rows = await db
        .select()
        .from(schema.jobDescriptions)
        .where(and(...where))
        .orderBy(desc(schema.jobDescriptions.createdAt));

      const clientRows = rows.length
        ? await db
            .select({ id: schema.clients.id, companyName: schema.clients.companyName })
            .from(schema.clients)
            .where(eq(schema.clients.agencyId, context.agencyId))
        : [];

      const now = new Date();
      const matchStats = rows.length
        ? await db
            .select({
              jdId: schema.cvJdMatches.jdId,
              total: sql<number>`count(*)`,
              shortlisted: sql<number>`sum(case when ${schema.cvJdMatches.isShortlisted} = 1 then 1 else 0 end)`,
              live: sql<number>`sum(case when ${schema.cvJdMatches.expiresAt} > ${now.getTime()} then 1 else 0 end)`,
              best: sql<number>`max(case when ${schema.cvJdMatches.expiresAt} > ${now.getTime()} then ${schema.cvJdMatches.matchScore} else null end)`,
            })
            .from(schema.cvJdMatches)
            .where(inArray(schema.cvJdMatches.jdId, rows.map((r) => r.id)))
            .groupBy(schema.cvJdMatches.jdId)
        : [];

      return rows.map((job) => {
        const stats = matchStats.find((m) => m.jdId === job.id);
        return {
          ...job,
          clientName: clientRows.find((c) => c.id === job.clientId)?.companyName ?? null,
          matchCount: Number(stats?.total ?? 0),
          liveMatchCount: Number(stats?.live ?? 0),
          expiredMatchCount: Number(stats?.total ?? 0) - Number(stats?.live ?? 0),
          shortlistedCount: Number(stats?.shortlisted ?? 0),
          bestScore: stats?.best != null ? Math.round(Number(stats.best) * 10) / 10 : null,
          isParsed: Boolean(job.jdVector),
        };
      });
    }),

  get: authed.input(z.object({ id: z.string() })).handler(async ({ input, context }) => {
    const [job] = await db
      .select()
      .from(schema.jobDescriptions)
      .where(
        and(eq(schema.jobDescriptions.id, input.id), eq(schema.jobDescriptions.agencyId, context.agencyId)),
      )
      .limit(1);
    if (!job) throw new ORPCError("NOT_FOUND", { message: "Job not found" });

    const client = job.clientId
      ? (await db.select().from(schema.clients).where(eq(schema.clients.id, job.clientId)).limit(1))[0]
      : null;

    return {
      ...job,
      jdVector: null,
      client: client ?? null,
      isParsed: Boolean(job.jdVector),
    };
  }),

  create: authed.input(jobInput).handler(async ({ input, context }) => {
    const id = newId("jd");
    const [row] = await db
      .insert(schema.jobDescriptions)
      .values({
        id,
        agencyId: context.agencyId,
        createdBy: context.user.id,
        ...input,
        salaryRange: salaryDisplay(input),
      })
      .returning();
    await ingestJd(id, input.title);
    await audit(context.user, "jd.created", "job_description", id, { title: input.title });
    const [fresh] = await db
      .select()
      .from(schema.jobDescriptions)
      .where(eq(schema.jobDescriptions.id, id))
      .limit(1);
    return { ...(fresh ?? row!), jdVector: null };
  }),

  update: authed
    .input(jobInput.partial().extend({ id: z.string(), status: z.enum(STATUSES).optional() }))
    .handler(async ({ input, context }) => {
      const { id, ...rest } = input;
      const patch: Record<string, unknown> = { ...rest };
      if (
        rest.salaryCurrency !== undefined ||
        rest.salaryMin !== undefined ||
        rest.salaryMax !== undefined ||
        rest.salaryPeriod !== undefined
      ) {
        patch.salaryRange = salaryDisplay(rest);
      }
      if (rest.status === "closed" || rest.status === "filled") patch.closedAt = new Date();
      const [row] = await db
        .update(schema.jobDescriptions)
        .set(patch)
        .where(
          and(eq(schema.jobDescriptions.id, id), eq(schema.jobDescriptions.agencyId, context.agencyId)),
        )
        .returning();
      if (!row) throw new ORPCError("NOT_FOUND");
      if (rest.jdFilePath || rest.jdText) await ingestJd(id, row.title);
      await audit(context.user, "jd.updated", "job_description", id, rest);
      return { ...row, jdVector: null };
    }),

  /** Re-extract + re-parse + re-embed the JD document. */
  reparse: authed.input(z.object({ id: z.string() })).handler(async ({ input, context }) => {
    const [job] = await db
      .select()
      .from(schema.jobDescriptions)
      .where(
        and(eq(schema.jobDescriptions.id, input.id), eq(schema.jobDescriptions.agencyId, context.agencyId)),
      )
      .limit(1);
    if (!job) throw new ORPCError("NOT_FOUND");
    await ingestJd(job.id, job.title);
    return { ok: true };
  }),

  remove: authed.input(z.object({ id: z.string() })).handler(async ({ input, context }) => {
    await db.delete(schema.cvJdMatches).where(eq(schema.cvJdMatches.jdId, input.id));
    await db
      .delete(schema.jobDescriptions)
      .where(
        and(eq(schema.jobDescriptions.id, input.id), eq(schema.jobDescriptions.agencyId, context.agencyId)),
      );
    await audit(context.user, "jd.deleted", "job_description", input.id);
    return { ok: true };
  }),

  /**
   * View 1 — Job Description View: top suitable candidates for this JD.
   * Expired matches (>60 days) are excluded from the ranking and returned
   * separately so the UI can offer a re-run instead of showing a stale score.
   */
  matches: authed
    .input(z.object({ jdId: z.string(), limit: z.number().min(1).max(200).default(50) }))
    .handler(async ({ input, context }) => {
      const rows = await db
        .select({
          match: schema.cvJdMatches,
          candidate: {
            id: schema.candidates.id,
            firstName: schema.candidates.firstName,
            lastName: schema.candidates.lastName,
            email: schema.candidates.email,
            headline: schema.candidates.headline,
            location: schema.candidates.location,
            experienceYears: schema.candidates.experienceYears,
            currentStatus: schema.candidates.currentStatus,
            currentStage: schema.candidates.currentStage,
            tags: schema.candidates.tags,
          },
        })
        .from(schema.cvJdMatches)
        .innerJoin(schema.candidates, eq(schema.candidates.id, schema.cvJdMatches.candidateId))
        .where(
          and(eq(schema.cvJdMatches.jdId, input.jdId), eq(schema.cvJdMatches.agencyId, context.agencyId)),
        )
        .orderBy(desc(schema.cvJdMatches.matchScore))
        .limit(input.limit);

      const now = new Date();
      const live = rows.filter((r) => !isExpired(r.match.expiresAt, now));
      const expired = rows.filter((r) => isExpired(r.match.expiresAt, now));

      return {
        ranked: live.map((r, i) => ({ rank: i + 1, ...r })),
        expired: expired.map((r) => ({
          ...r,
          match: { ...r.match, matchScore: null as number | null },
        })),
      };
    }),
};
