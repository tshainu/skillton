import { z } from "zod";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { db } from "../database";
import * as schema from "../database/schema";
import { newId, newToken } from "../lib/ids";
import { adminOnly, audit, authed, timeline } from "../middleware/auth";
import { isExpired } from "../lib/scoring";

const RESULTS = ["selected", "hold", "rejected"] as const;

/** HR screening: configurable form → Selected (no tag) / Hold (yellow) / Rejected (red). */
export const screening = {
  questions: authed.handler(({ context }) =>
    db
      .select()
      .from(schema.hrQuestions)
      .where(
        and(eq(schema.hrQuestions.agencyId, context.agencyId), eq(schema.hrQuestions.isActive, true)),
      )
      .orderBy(asc(schema.hrQuestions.sortOrder)),
  ),

  saveQuestion: adminOnly
    .input(
      z.object({
        id: z.string().optional(),
        label: z.string().min(1),
        fieldType: z.enum(["text", "rating", "boolean", "select"]),
        options: z.array(z.string()).optional(),
        sortOrder: z.number().default(0),
      }),
    )
    .handler(async ({ input, context }) => {
      if (input.id) {
        await db
          .update(schema.hrQuestions)
          .set({
            label: input.label,
            fieldType: input.fieldType,
            options: input.options ?? null,
            sortOrder: input.sortOrder,
          })
          .where(
            and(eq(schema.hrQuestions.id, input.id), eq(schema.hrQuestions.agencyId, context.agencyId)),
          );
        return { id: input.id };
      }
      const id = newId("hrq");
      await db.insert(schema.hrQuestions).values({
        id,
        agencyId: context.agencyId,
        label: input.label,
        fieldType: input.fieldType,
        options: input.options ?? null,
        sortOrder: input.sortOrder,
      });
      return { id };
    }),

  removeQuestion: adminOnly.input(z.object({ id: z.string() })).handler(async ({ input, context }) => {
    await db
      .update(schema.hrQuestions)
      .set({ isActive: false })
      .where(and(eq(schema.hrQuestions.id, input.id), eq(schema.hrQuestions.agencyId, context.agencyId)));
    return { ok: true };
  }),

  /** Candidates waiting for HR screening — shortlisted with a live (non-expired) score. */
  queue: authed.handler(async ({ context }) => {
    const rows = await db
      .select({
        candidate: {
          id: schema.candidates.id,
          firstName: schema.candidates.firstName,
          lastName: schema.candidates.lastName,
          email: schema.candidates.email,
          phone: schema.candidates.phone,
          headline: schema.candidates.headline,
          experienceYears: schema.candidates.experienceYears,
          currentStatus: schema.candidates.currentStatus,
          currentStage: schema.candidates.currentStage,
          nic: schema.candidates.nic,
          bucket: schema.candidates.bucket,
          bucketReason: schema.candidates.bucketReason,
          tags: schema.candidates.tags,
          /* Date the candidate entered screening — what the list filters on. */
          updatedAt: schema.candidates.updatedAt,
          createdAt: schema.candidates.createdAt,
        },
        match: schema.cvJdMatches,
        jobTitle: schema.jobDescriptions.title,
      })
      .from(schema.candidates)
      .leftJoin(schema.cvJdMatches, eq(schema.cvJdMatches.candidateId, schema.candidates.id))
      .leftJoin(schema.jobDescriptions, eq(schema.jobDescriptions.id, schema.cvJdMatches.jdId))
      .where(
        and(
          eq(schema.candidates.agencyId, context.agencyId),
          eq(schema.candidates.isBlacklisted, false),
          /* Only candidates still awaiting an HR decision. Once they are marked
             for the AI interview they belong to the AI interview page. */
          sql`${schema.candidates.currentStatus} in ('shortlisted','hr_screening','hr_hold')`,
        ),
      )
      .orderBy(desc(schema.cvJdMatches.matchScore));

    const byCandidate = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const existing = byCandidate.get(row.candidate.id);
      if (!existing || (row.match?.matchScore ?? 0) > (existing.match?.matchScore ?? 0)) {
        byCandidate.set(row.candidate.id, row);
      }
    }

    const now = new Date();
    return [...byCandidate.values()].map((row) => {
      const expired = row.match ? isExpired(row.match.expiresAt, now) : true;
      return {
        ...row.candidate,
        jdId: row.match?.jdId ?? null,
        jobTitle: row.jobTitle,
        score: row.match && !expired ? Math.round(row.match.matchScore * 10) / 10 : null,
        scoreExpired: Boolean(row.match) && expired,
      };
    });
  }),

  history: authed
    /* `candidateId` must be optional inside the object too: the screening page
       sends `{ candidateId: undefined }` for the full history, which a required
       field rejected outright — the History tab was answering 400 every time. */
    .input(z.object({ candidateId: z.string().optional() }).optional())
    .handler(({ input, context }) =>
      db
        .select()
        .from(schema.interviewsHr)
        .where(
          input?.candidateId
            ? and(
                eq(schema.interviewsHr.agencyId, context.agencyId),
                eq(schema.interviewsHr.candidateId, input.candidateId),
              )
            : eq(schema.interviewsHr.agencyId, context.agencyId),
        )
        .orderBy(desc(schema.interviewsHr.conductedAt))
        .limit(100),
    ),

  submit: authed
    .input(
      z.object({
        candidateId: z.string(),
        jdId: z.string().optional(),
        communicationScore: z.number().min(1).max(10).optional(),
        salaryExpectation: z.string().optional(),
        noticePeriod: z.string().optional(),
        willingToRelocate: z.boolean().optional(),
        answers: z.record(z.string(), z.string()).optional(),
        overallNotes: z.string().optional(),
        result: z.enum(RESULTS),
      }),
    )
    .handler(async ({ input, context }) => {
      const [candidate] = await db
        .select({ id: schema.candidates.id })
        .from(schema.candidates)
        .where(
          and(
            eq(schema.candidates.id, input.candidateId),
            eq(schema.candidates.agencyId, context.agencyId),
          ),
        )
        .limit(1);
      if (!candidate) throw new ORPCError("NOT_FOUND", { message: "Candidate not found" });

      const id = newId("hri");
      await db.insert(schema.interviewsHr).values({
        id,
        agencyId: context.agencyId,
        candidateId: input.candidateId,
        jdId: input.jdId,
        recruiterId: context.user.id,
        communicationScore: input.communicationScore,
        salaryExpectation: input.salaryExpectation,
        noticePeriod: input.noticePeriod,
        willingToRelocate: input.willingToRelocate,
        answers: input.answers ?? {},
        overallNotes: input.overallNotes,
        result: input.result,
      });

      /* Selected → no tag, moves to AI interview queue. Hold → yellow. Rejected → red. */
      const transition = {
        selected: { status: "ai_interview_pending", stage: "ai_interview", tags: [] as string[] },
        hold: { status: "hr_hold", stage: "screening", tags: ["hold"] },
        rejected: { status: "hr_rejected", stage: "screening", tags: ["rejected"] },
      }[input.result];

      await db
        .update(schema.candidates)
        .set({
          currentStatus: transition.status,
          currentStage: transition.stage,
          tags: transition.tags,
          /* Rejected CVs: retention 30 days after rejection. */
          ...(input.result === "rejected"
            ? {
                retentionPolicy: "marked_for_deletion",
                deletionScheduledAt: new Date(Date.now() + 30 * 86_400_000),
              }
            : { retentionPolicy: "standard", deletionScheduledAt: null }),
          updatedAt: new Date(),
        })
        .where(eq(schema.candidates.id, input.candidateId));

      await timeline(
        context.agencyId,
        input.candidateId,
        "hr_screening",
        `HR screening — ${input.result}`,
        input.overallNotes,
        context.user.name,
      );
      await audit(context.user, "hr.screening_submitted", "candidate", input.candidateId, {
        result: input.result,
      });

      return { id, nextStatus: transition.status };
    }),

  /**
   * Bulk-mark screened candidates as selected for the AI interview. Creates the
   * invite row for each so they appear on the AI interview page immediately.
   */
  markForAiInterview: authed
    .input(
      z.object({
        candidateIds: z.array(z.string()).min(1).max(100),
        jdId: z.string().optional(),
        validDays: z.number().min(1).max(60).default(7),
      }),
    )
    .handler(async ({ input, context }) => {
      const rows = await db
        .select()
        .from(schema.candidates)
        .where(
          and(
            eq(schema.candidates.agencyId, context.agencyId),
            eq(schema.candidates.isBlacklisted, false),
            inArray(schema.candidates.id, input.candidateIds),
          ),
        );
      if (!rows.length) throw new ORPCError("NOT_FOUND", { message: "No matching candidates" });

      const open = await db
        .select({ candidateId: schema.interviewsAi.candidateId })
        .from(schema.interviewsAi)
        .where(
          and(
            eq(schema.interviewsAi.agencyId, context.agencyId),
            inArray(schema.interviewsAi.candidateId, rows.map((r) => r.id)),
            sql`${schema.interviewsAi.status} in ('pending','in_progress')`,
          ),
        );
      const alreadyInvited = new Set(open.map((o) => o.candidateId));
      const toInvite = rows.filter((r) => !alreadyInvited.has(r.id));

      const created: { candidateId: string; token: string }[] = [];
      if (toInvite.length) {
        const values = toInvite.map((c) => ({
          id: newId("aii"),
          agencyId: context.agencyId,
          candidateId: c.id,
          jdId: input.jdId ?? null,
          token: newToken(),
          status: "pending",
          expiresAt: new Date(Date.now() + input.validDays * 86_400_000),
        }));
        await db.insert(schema.interviewsAi).values(values);
        created.push(...values.map((v) => ({ candidateId: v.candidateId, token: v.token })));
      }

      await db
        .update(schema.candidates)
        .set({
          currentStatus: "ai_interview_pending",
          currentStage: "ai_interview",
          updatedAt: new Date(),
        })
        .where(inArray(schema.candidates.id, rows.map((r) => r.id)));

      await db.insert(schema.candidateEvents).values(
        rows.map((c) => ({
          id: newId("evt"),
          agencyId: context.agencyId,
          candidateId: c.id,
          kind: "ai_interview",
          title: "Selected for AI interview",
          detail: "Marked from HR screening",
          actorName: context.user.name,
        })),
      );

      await audit(context.user, "hr.marked_for_ai_interview", "candidate", undefined, {
        count: rows.length,
        created: created.length,
      });

      return { selected: rows.length, invited: created.length, alreadyInvited: alreadyInvited.size, created };
    }),
};
