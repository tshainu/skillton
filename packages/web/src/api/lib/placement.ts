/**
 * Placement records — the single source of truth for the Placed page, the
 * placement report and every "hired" number on the dashboard.
 *
 * A candidate can reach `hired` from two places: the explicit "Mark hired"
 * action, and a client interview recorded as `placed`. Both must write a
 * placement row, otherwise the Placed page and the dashboard disagree with the
 * candidate's own status — which is exactly what used to happen. This helper is
 * the only writer, so the two paths can never drift apart again.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../database";
import * as schema from "../database/schema";
import { newId } from "./ids";
import { formatMoney, normalizeCurrency } from "./currency";

export interface EnsurePlacementInput {
  agencyId: string;
  candidateId: string;
  jdId?: string | null;
  clientId?: string | null;
  recruiterId: string;
  recruiterName: string;
  offeredSalary?: string;
  offeredSalaryAmount?: number | null;
  salaryCurrency?: string;
  startDate?: Date | null;
  notes?: string | null;
}

export interface EnsurePlacementResult {
  placementId: string;
  /** False when the candidate already had a placement row. */
  created: boolean;
  positionTitle: string;
  clientName: string | null;
}

/**
 * Creates the placement record for a candidate, unless one already exists.
 * Also closes the job once its openings are filled. Never touches the
 * candidate's own status — the caller owns that.
 */
export async function ensurePlacement(input: EnsurePlacementInput): Promise<EnsurePlacementResult> {
  const [candidate] = await db
    .select()
    .from(schema.candidates)
    .where(and(eq(schema.candidates.id, input.candidateId), eq(schema.candidates.agencyId, input.agencyId)))
    .limit(1);
  if (!candidate) throw new Error("Candidate not found");

  const [existing] = await db
    .select({
      id: schema.placements.id,
      positionTitle: schema.placements.positionTitle,
      clientName: schema.placements.clientName,
    })
    .from(schema.placements)
    .where(eq(schema.placements.candidateId, input.candidateId))
    .limit(1);
  if (existing) {
    return {
      placementId: existing.id,
      created: false,
      positionTitle: existing.positionTitle,
      clientName: existing.clientName,
    };
  }

  /* Fall back to the candidate's best match when no job was named, so a
     placement recorded from the client-interview screen still says where they
     went instead of "Unspecified position". */
  let jdId = input.jdId ?? null;
  if (!jdId) {
    const [best] = await db
      .select({ jdId: schema.cvJdMatches.jdId })
      .from(schema.cvJdMatches)
      .where(
        and(
          eq(schema.cvJdMatches.candidateId, input.candidateId),
          eq(schema.cvJdMatches.agencyId, input.agencyId),
        ),
      )
      .orderBy(desc(schema.cvJdMatches.matchScore))
      .limit(1);
    jdId = best?.jdId ?? null;
  }

  const job = jdId
    ? (await db.select().from(schema.jobDescriptions).where(eq(schema.jobDescriptions.id, jdId)).limit(1))[0]
    : undefined;

  const clientId = input.clientId ?? job?.clientId ?? null;
  const client = clientId
    ? (await db.select().from(schema.clients).where(eq(schema.clients.id, clientId)).limit(1))[0]
    : undefined;

  const [match] = jdId
    ? await db
        .select({ matchScore: schema.cvJdMatches.matchScore })
        .from(schema.cvJdMatches)
        .where(and(eq(schema.cvJdMatches.candidateId, input.candidateId), eq(schema.cvJdMatches.jdId, jdId)))
        .limit(1)
    : [];

  const [tech] = await db
    .select({ totalScore: schema.interviewsTechnical.totalScore })
    .from(schema.interviewsTechnical)
    .where(eq(schema.interviewsTechnical.candidateId, input.candidateId))
    .orderBy(desc(schema.interviewsTechnical.conductedAt))
    .limit(1);

  const matchScore = match?.matchScore ?? null;
  const techScore = tech?.totalScore ?? null;
  const finalScore =
    techScore != null ? Math.round(((matchScore ?? 0) * 0.2 + techScore * 0.8) * 10) / 10 : null;

  const placementId = newId("plc");
  const positionTitle = job?.title ?? "Unspecified position";
  await db.insert(schema.placements).values({
    id: placementId,
    agencyId: input.agencyId,
    candidateId: candidate.id,
    jdId: jdId ?? undefined,
    clientId,
    candidateName: `${candidate.firstName} ${candidate.lastName ?? ""}`.trim(),
    candidateEmail: candidate.email,
    positionTitle,
    clientName: client?.companyName ?? null,
    department: job?.department ?? null,
    location: job?.location ?? candidate.location ?? null,
    offeredSalary:
      input.offeredSalaryAmount != null
        ? formatMoney(input.offeredSalaryAmount, input.salaryCurrency, "month")
        : input.offeredSalary,
    salaryCurrency: normalizeCurrency(input.salaryCurrency),
    offeredSalaryAmount: input.offeredSalaryAmount ?? null,
    startDate: input.startDate ?? null,
    matchScoreAtHire: matchScore,
    techScoreAtHire: techScore,
    finalScore,
    timeToHireDays: Math.max(0, Math.round((Date.now() - candidate.createdAt.getTime()) / 86_400_000)),
    recruiterId: input.recruiterId,
    recruiterName: input.recruiterName,
    notes: input.notes ?? undefined,
  });

  /* A job whose openings are all filled closes itself. */
  if (jdId) {
    const openings = job?.openings ?? 1;
    const [placedForJob] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.placements)
      .where(eq(schema.placements.jdId, jdId));
    if (Number(placedForJob?.count ?? 0) >= openings) {
      await db
        .update(schema.jobDescriptions)
        .set({ status: "filled", closedAt: new Date() })
        .where(eq(schema.jobDescriptions.id, jdId));
    }
  }

  return { placementId, created: true, positionTitle, clientName: client?.companyName ?? null };
}

/**
 * Repairs history: creates the missing placement row for every candidate already
 * marked `hired` without one. Safe to run repeatedly.
 */
export async function backfillPlacements(agencyId: string, recruiter: { id: string; name: string }) {
  const hired = await db
    .select({ id: schema.candidates.id })
    .from(schema.candidates)
    .where(and(eq(schema.candidates.agencyId, agencyId), eq(schema.candidates.currentStatus, "hired")));

  let created = 0;
  for (const candidate of hired) {
    const result = await ensurePlacement({
      agencyId,
      candidateId: candidate.id,
      recruiterId: recruiter.id,
      recruiterName: recruiter.name,
      notes: "Placement record reconstructed from the candidate's hired status.",
    });
    if (result.created) created++;
  }
  return { checked: hired.length, created };
}
