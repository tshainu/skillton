import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { db } from "../database";
import * as schema from "../database/schema";
import { newId } from "../lib/ids";
import { audit, authed, adminOnly } from "../middleware/auth";

/**
 * AI interview question banks, one set per job title (optionally bound to a
 * single JD). The voice agent is instructed to ask only from the matching set
 * and its follow-ups — nothing off-topic.
 */

const questionSchema = z.object({
  question: z.string().min(3).max(500),
  followUps: z.array(z.string().min(2).max(500)).max(6).default([]),
});

export const questionSets = {
  list: authed.handler(async ({ context }) => {
    const rows = await db
      .select()
      .from(schema.aiQuestionSets)
      .where(eq(schema.aiQuestionSets.agencyId, context.agencyId))
      .orderBy(desc(schema.aiQuestionSets.updatedAt));

    const jobs = await db
      .select({ id: schema.jobDescriptions.id, title: schema.jobDescriptions.title })
      .from(schema.jobDescriptions)
      .where(eq(schema.jobDescriptions.agencyId, context.agencyId))
      .orderBy(schema.jobDescriptions.title);

    return {
      jobs,
      /** Distinct job titles already in use, for the title suggestion list. */
      titles: [...new Set(jobs.map((j) => j.title))],
      sets: rows.map((r) => ({
        id: r.id,
        jobTitle: r.jobTitle,
        jdId: r.jdId,
        jdTitle: r.jdId ? (jobs.find((j) => j.id === r.jdId)?.title ?? null) : null,
        description: r.description,
        questions: r.questions ?? [],
        questionCount: (r.questions ?? []).length,
        isActive: r.isActive,
        updatedAt: r.updatedAt,
      })),
    };
  }),

  create: adminOnly
    .input(
      z.object({
        jobTitle: z.string().min(2).max(120),
        jdId: z.string().optional(),
        description: z.string().max(500).optional(),
        questions: z.array(questionSchema).min(1).max(40),
      }),
    )
    .handler(async ({ input, context }) => {
      const id = newId("aiqs");
      await db.insert(schema.aiQuestionSets).values({
        id,
        agencyId: context.agencyId,
        jobTitle: input.jobTitle.trim(),
        jdId: input.jdId ?? null,
        description: input.description ?? null,
        questions: input.questions,
        createdBy: context.user.name,
      });
      await audit(context.user, "question_set.created", "ai_question_set", id, {
        jobTitle: input.jobTitle,
        count: input.questions.length,
      });
      return { id };
    }),

  update: adminOnly
    .input(
      z.object({
        id: z.string(),
        jobTitle: z.string().min(2).max(120).optional(),
        jdId: z.string().nullable().optional(),
        description: z.string().max(500).nullable().optional(),
        questions: z.array(questionSchema).max(40).optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const { id, ...rest } = input;
      const patch = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
      if (!Object.keys(patch).length) return { ok: true };

      const result = await db
        .update(schema.aiQuestionSets)
        .set({ ...patch, updatedAt: new Date() })
        .where(
          and(eq(schema.aiQuestionSets.id, id), eq(schema.aiQuestionSets.agencyId, context.agencyId)),
        );
      if (!result.rowsAffected) throw new ORPCError("NOT_FOUND", { message: "Question set not found" });

      await audit(context.user, "question_set.updated", "ai_question_set", id, patch);
      return { ok: true };
    }),

  remove: adminOnly.input(z.object({ id: z.string() })).handler(async ({ input, context }) => {
    await db
      .delete(schema.aiQuestionSets)
      .where(
        and(eq(schema.aiQuestionSets.id, input.id), eq(schema.aiQuestionSets.agencyId, context.agencyId)),
      );
    await audit(context.user, "question_set.deleted", "ai_question_set", input.id);
    return { ok: true };
  }),

  /** The set that will actually drive an interview for this JD / title. */
  resolve: authed
    .input(z.object({ jdId: z.string().optional(), jobTitle: z.string().optional() }))
    .handler(async ({ input, context }) => {
      const set = await resolveQuestionSet(context.agencyId, input.jdId, input.jobTitle);
      return set
        ? { id: set.id, jobTitle: set.jobTitle, questions: set.questions ?? [] }
        : { id: null, jobTitle: input.jobTitle ?? null, questions: [] };
    }),
};

/**
 * Pick the question set for an interview: an exact JD binding wins, otherwise
 * the newest active set whose job title matches case-insensitively.
 */
export async function resolveQuestionSet(agencyId: string, jdId?: string | null, jobTitle?: string | null) {
  if (jdId) {
    const [bound] = await db
      .select()
      .from(schema.aiQuestionSets)
      .where(
        and(
          eq(schema.aiQuestionSets.agencyId, agencyId),
          eq(schema.aiQuestionSets.jdId, jdId),
          eq(schema.aiQuestionSets.isActive, true),
        ),
      )
      .limit(1);
    if (bound) return bound;
  }
  if (jobTitle) {
    const [byTitle] = await db
      .select()
      .from(schema.aiQuestionSets)
      .where(
        and(
          eq(schema.aiQuestionSets.agencyId, agencyId),
          eq(schema.aiQuestionSets.isActive, true),
          sql`lower(${schema.aiQuestionSets.jobTitle}) = ${jobTitle.trim().toLowerCase()}`,
        ),
      )
      .orderBy(desc(schema.aiQuestionSets.updatedAt))
      .limit(1);
    if (byTitle) return byTitle;
  }
  return null;
}
