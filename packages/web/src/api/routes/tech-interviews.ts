import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { db } from "../database";
import * as schema from "../database/schema";
import { newId } from "../lib/ids";
import { adminOnly, audit, authed, getSettings, notify, timeline } from "../middleware/auth";
import { finalScore, isExpired } from "../lib/scoring";
import { scoreComment } from "../lib/sentiment";
import type { TechSection } from "../database/schema";

const sectionSchema = z.object({
  name: z.string(),
  weight: z.number().min(0).max(100),
  parameters: z.array(z.string()).min(1),
});

/** Weighted total on a 0-100 scale from per-parameter ratings. */
function computeTotal(
  sections: TechSection[],
  scores: Record<string, Record<string, number>>,
  scaleMax: number,
): number {
  const weightSum = sections.reduce((sum, s) => sum + s.weight, 0) || 1;
  let total = 0;
  for (const section of sections) {
    const given = scores[section.name] ?? {};
    const values = section.parameters.map((p) => given[p]).filter((v): v is number => typeof v === "number");
    if (!values.length) continue;
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    total += (avg / scaleMax) * (section.weight / weightSum) * 100;
  }
  return Math.round(total * 10) / 10;
}

/** Technical interview — the primary score in final candidate ranking (80%). */
export const techInterviews = {
  templates: authed.handler(({ context }) =>
    db
      .select()
      .from(schema.techTemplates)
      .where(eq(schema.techTemplates.agencyId, context.agencyId))
      .orderBy(desc(schema.techTemplates.isDefault)),
  ),

  saveTemplate: adminOnly
    .input(
      z.object({
        id: z.string().optional(),
        name: z.string().min(1),
        ratingScaleMax: z.number().min(3).max(100).default(10),
        sections: z.array(sectionSchema).min(1),
        isDefault: z.boolean().default(false),
      }),
    )
    .handler(async ({ input, context }) => {
      if (input.isDefault) {
        await db
          .update(schema.techTemplates)
          .set({ isDefault: false })
          .where(eq(schema.techTemplates.agencyId, context.agencyId));
      }
      if (input.id) {
        await db
          .update(schema.techTemplates)
          .set({
            name: input.name,
            ratingScaleMax: input.ratingScaleMax,
            sections: input.sections,
            isDefault: input.isDefault,
          })
          .where(
            and(
              eq(schema.techTemplates.id, input.id),
              eq(schema.techTemplates.agencyId, context.agencyId),
            ),
          );
        return { id: input.id };
      }
      const id = newId("tpl");
      await db.insert(schema.techTemplates).values({
        id,
        agencyId: context.agencyId,
        name: input.name,
        ratingScaleMax: input.ratingScaleMax,
        sections: input.sections,
        isDefault: input.isDefault,
      });
      await audit(context.user, "tech_template.created", "tech_template", id, { name: input.name });
      return { id };
    }),

  removeTemplate: adminOnly.input(z.object({ id: z.string() })).handler(async ({ input, context }) => {
    await db
      .delete(schema.techTemplates)
      .where(
        and(eq(schema.techTemplates.id, input.id), eq(schema.techTemplates.agencyId, context.agencyId)),
      );
    return { ok: true };
  }),

  /** Candidates cleared by the AI interview and awaiting a technical round. */
  queue: authed.handler(async ({ context }) => {
    const rows = await db
      .select({
        id: schema.candidates.id,
        firstName: schema.candidates.firstName,
        lastName: schema.candidates.lastName,
        headline: schema.candidates.headline,
        experienceYears: schema.candidates.experienceYears,
        currentStatus: schema.candidates.currentStatus,
        technologies: schema.candidates.technologies,
      })
      .from(schema.candidates)
      .where(
        and(
          eq(schema.candidates.agencyId, context.agencyId),
          sql`${schema.candidates.currentStatus} in ('tech_interview_pending','ai_interview_completed')`,
        ),
      )
      .orderBy(desc(schema.candidates.updatedAt));

    if (!rows.length) return [];

    /* Attach AI interview focus suggestions + the live match score. */
    const ai = await db
      .select({
        candidateId: schema.interviewsAi.candidateId,
        suggestedTechFocus: schema.interviewsAi.suggestedTechFocus,
        assessment: schema.interviewsAi.assessment,
      })
      .from(schema.interviewsAi)
      .where(eq(schema.interviewsAi.agencyId, context.agencyId));

    const matches = await db
      .select({
        candidateId: schema.cvJdMatches.candidateId,
        jdId: schema.cvJdMatches.jdId,
        matchScore: schema.cvJdMatches.matchScore,
        expiresAt: schema.cvJdMatches.expiresAt,
      })
      .from(schema.cvJdMatches)
      .where(eq(schema.cvJdMatches.agencyId, context.agencyId))
      .orderBy(desc(schema.cvJdMatches.matchScore));

    const now = new Date();
    return rows.map((row) => {
      const match = matches.find((m) => m.candidateId === row.id);
      const expired = match ? isExpired(match.expiresAt, now) : true;
      const aiRow = ai.find((a) => a.candidateId === row.id);
      return {
        ...row,
        jdId: match?.jdId ?? null,
        matchScore: match && !expired ? Math.round(match.matchScore * 10) / 10 : null,
        scoreExpired: Boolean(match) && expired,
        suggestedTechFocus: aiRow?.suggestedTechFocus ?? [],
        aiAssessment: aiRow?.assessment ?? null,
      };
    });
  }),

  list: authed.handler(() =>
    db
      .select({
        interview: schema.interviewsTechnical,
        candidateName: sql<string>`${schema.candidates.firstName} || ' ' || coalesce(${schema.candidates.lastName}, '')`,
        jobTitle: schema.jobDescriptions.title,
      })
      .from(schema.interviewsTechnical)
      .innerJoin(schema.candidates, eq(schema.candidates.id, schema.interviewsTechnical.candidateId))
      .leftJoin(schema.jobDescriptions, eq(schema.jobDescriptions.id, schema.interviewsTechnical.jdId))
      .orderBy(desc(schema.interviewsTechnical.conductedAt))
      .limit(100),
  ),

  submit: authed
    .input(
      z.object({
        candidateId: z.string(),
        jdId: z.string().optional(),
        templateId: z.string(),
        sectionScores: z.record(z.string(), z.record(z.string(), z.number())),
        comments: z.string().optional(),
        selectionReason: z.string().optional(),
        recommendation: z.enum(["selected", "hold", "rejected"]),
      }),
    )
    .handler(async ({ input, context }) => {
      const settings = await getSettings(context.agencyId);
      const [template] = await db
        .select()
        .from(schema.techTemplates)
        .where(
          and(
            eq(schema.techTemplates.id, input.templateId),
            eq(schema.techTemplates.agencyId, context.agencyId),
          ),
        )
        .limit(1);
      if (!template) throw new ORPCError("NOT_FOUND", { message: "Template not found" });

      const rawScore = computeTotal(template.sections ?? [], input.sectionScores, template.ratingScaleMax);

      /* The interviewer's written comment shifts the score by at most ±8 points:
         genuine praise adds, criticism subtracts, neutral notes change nothing. */
      const sentiment = await scoreComment(input.comments);
      const total = Math.round(Math.max(0, Math.min(100, rawScore + sentiment.adjustment)) * 10) / 10;

      const id = newId("tci");
      await db.insert(schema.interviewsTechnical).values({
        id,
        agencyId: context.agencyId,
        candidateId: input.candidateId,
        jdId: input.jdId,
        interviewerId: context.user.id,
        templateId: input.templateId,
        totalScore: total,
        rawScore,
        sentimentAdjustment: sentiment.adjustment,
        commentSentiment: sentiment.sentiment,
        sentimentRationale: sentiment.rationale,
        sectionScores: input.sectionScores,
        comments: input.comments,
        selectionReason: input.selectionReason,
        recommendation: input.recommendation,
      });

      const [match] = input.jdId
        ? await db
            .select()
            .from(schema.cvJdMatches)
            .where(
              and(
                eq(schema.cvJdMatches.candidateId, input.candidateId),
                eq(schema.cvJdMatches.jdId, input.jdId),
              ),
            )
            .limit(1)
        : [];

      /* Expired match scores contribute 0 and are reported as expired. */
      const liveMatch = match && !isExpired(match.expiresAt) ? match.matchScore : null;
      const final = finalScore(liveMatch, total, settings);

      const nextStatus =
        input.recommendation === "selected"
          ? "final_review"
          : input.recommendation === "rejected"
            ? "rejected"
            : "tech_interview_completed";

      /* Selected -> flagged, waiting on the client-side interview decision.
         Rejected after a strong AI interview -> blue "hidden gem" tag. */
      const [completedAi] = await db
        .select({ id: schema.interviewsAi.id })
        .from(schema.interviewsAi)
        .where(
          and(
            eq(schema.interviewsAi.candidateId, input.candidateId),
            eq(schema.interviewsAi.status, "completed"),
          ),
        )
        .limit(1);

      const blueTag =
        input.recommendation === "rejected" &&
        Boolean(completedAi) &&
        (liveMatch ?? 0) >= settings.blueTagMinAiMatch;

      await db
        .update(schema.candidates)
        .set({
          currentStatus: nextStatus,
          currentStage: input.recommendation === "selected" ? "client_review" : "tech_interview",
          tags: input.recommendation === "rejected" ? ["rejected"] : ["tech_cleared"],
          isFlagged: input.recommendation === "selected",
          ...(blueTag
            ? {
                bucket: "blue",
                bucketReason: `AI interview passed at ${Math.round(liveMatch ?? 0)}% match, technical ${total}/100`,
                bucketSetAt: new Date(),
              }
            : {}),
          ...(input.recommendation === "rejected"
            ? {
                retentionPolicy: "marked_for_deletion",
                deletionScheduledAt: new Date(Date.now() + 90 * 86_400_000),
              }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.candidates.id, input.candidateId));

      await timeline(
        context.agencyId,
        input.candidateId,
        "tech_interview",
        `Technical interview — ${total}/100 (${input.recommendation})`,
        input.selectionReason,
        context.user.name,
      );
      await notify(
        context.agencyId,
        "Technical interview scored",
        `Score ${total}/100${final != null ? ` · final ${final}/100` : ""}.`,
        input.recommendation === "rejected" ? "danger" : "success",
        `/candidates/${input.candidateId}`,
      );
      await audit(context.user, "tech_interview.submitted", "candidate", input.candidateId, {
        total,
        recommendation: input.recommendation,
      });

      return {
        id,
        totalScore: total,
        rawScore,
        sentiment,
        blueTag,
        matchScore: liveMatch,
        matchScoreExpired: Boolean(match) && liveMatch === null,
        finalScore: final,
        weights: { match: settings.matchWeight, tech: settings.techWeight },
      };
    }),

  /** Final recruitment report data: match + HR + AI + tech + final score. */
  finalReport: authed
    .input(z.object({ candidateId: z.string(), jdId: z.string().optional() }))
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
      if (!candidate) throw new ORPCError("NOT_FOUND");

      const matchRows = await db
        .select({ match: schema.cvJdMatches, jobTitle: schema.jobDescriptions.title })
        .from(schema.cvJdMatches)
        .innerJoin(schema.jobDescriptions, eq(schema.jobDescriptions.id, schema.cvJdMatches.jdId))
        .where(
          input.jdId
            ? and(
                eq(schema.cvJdMatches.candidateId, input.candidateId),
                eq(schema.cvJdMatches.jdId, input.jdId),
              )
            : eq(schema.cvJdMatches.candidateId, input.candidateId),
        )
        .orderBy(desc(schema.cvJdMatches.matchScore))
        .limit(1);

      const [hr] = await db
        .select()
        .from(schema.interviewsHr)
        .where(eq(schema.interviewsHr.candidateId, input.candidateId))
        .orderBy(desc(schema.interviewsHr.conductedAt))
        .limit(1);

      const [ai] = await db
        .select()
        .from(schema.interviewsAi)
        .where(eq(schema.interviewsAi.candidateId, input.candidateId))
        .orderBy(desc(schema.interviewsAi.invitedAt))
        .limit(1);

      const [tech] = await db
        .select()
        .from(schema.interviewsTechnical)
        .where(eq(schema.interviewsTechnical.candidateId, input.candidateId))
        .orderBy(desc(schema.interviewsTechnical.conductedAt))
        .limit(1);

      const matchRow = matchRows[0];
      const expired = matchRow ? isExpired(matchRow.match.expiresAt) : true;
      const matchScore = matchRow && !expired ? matchRow.match.matchScore : null;
      const final = finalScore(matchScore, tech?.totalScore ?? null, settings);

      return {
        candidate: { ...candidate, cvVector: null },
        match: matchRow
          ? {
              jobTitle: matchRow.jobTitle,
              jdId: matchRow.match.jdId,
              score: matchScore == null ? null : Math.round(matchScore * 10) / 10,
              expired,
              skillsMatched: matchRow.match.skillsMatched,
              skillsMissing: matchRow.match.skillsMissing,
              aiExplanation: matchRow.match.aiExplanation,
            }
          : null,
        hr: hr ?? null,
        ai: ai ?? null,
        tech: tech ?? null,
        finalScore: final,
        weights: { match: settings.matchWeight, tech: settings.techWeight },
        recommendation:
          final == null
            ? "Awaiting technical interview"
            : final >= 75
              ? "Strong hire — proceed to offer"
              : final >= 60
                ? "Hire with reservations — client review recommended"
                : "Do not proceed",
      };
    }),
};
