/**
 * Match engine core — pure scoring, batched persistence and parallel AI
 * narration. Kept out of the routes file so the matrix / report features can
 * score without duplicating the formula.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "../database";
import * as schema from "../database/schema";
import { newId } from "./ids";
import { cosine } from "./embeddings";
import { computeMatchScore, expiryFor, overlap } from "./scoring";
import { explainMatch } from "./ai-extract";

export type MatchInsert = typeof schema.cvJdMatches.$inferInsert;

export interface BuiltMatch {
  values: MatchInsert;
  candidate: typeof schema.candidates.$inferSelect;
  job: typeof schema.jobDescriptions.$inferSelect;
  skills: { matched: string[]; missing: string[] };
  tech: { matched: string[]; missing: string[] };
  candidateSkills: string[];
  score: number;
}

/**
 * Pure, synchronous scoring of one candidate against one JD — no database and
 * no network. Everything expensive (persisting, AI explanations) is batched by
 * the callers, which is what keeps a full-pool run fast.
 */
export function buildMatch(
  agencyId: string,
  job: typeof schema.jobDescriptions.$inferSelect,
  candidate: typeof schema.candidates.$inferSelect,
  opts: { threshold: number; expiryDays: number },
): BuiltMatch {
  const requiredSkills = job.parsed?.skills ?? job.skillsRequired ?? [];
  const requiredTech = job.parsed?.technologies ?? [];
  const requiredCerts = job.parsed?.certifications ?? [];

  const candidateSkills = [...(candidate.skillsExtracted ?? []), ...(candidate.technologies ?? [])];

  const skills = overlap(requiredSkills, candidateSkills);
  const tech = overlap(requiredTech, candidateSkills);
  const certs = overlap(requiredCerts, candidate.certifications ?? []);

  const similarity = cosine(job.jdVector, candidate.cvVector);

  const breakdown = computeMatchScore({
    similarity,
    requiredSkills: [...new Set([...requiredSkills, ...requiredTech])],
    matchedSkills: [...new Set([...skills.matched, ...tech.matched])],
    candidateExperience: candidate.experienceYears ?? null,
    requiredExperience: job.parsed?.minExperienceYears ?? null,
    candidateEducation: candidate.education ?? [],
    requiredEducation: job.parsed?.education ?? null,
    candidateLocation: candidate.location ?? null,
    jobLocation: job.location ?? job.parsed?.location ?? null,
  });

  const matchedAt = new Date();
  const values: MatchInsert = {
    id: newId("mch"),
    agencyId,
    candidateId: candidate.id,
    jdId: job.id,
    matchScore: breakdown.total,
    baseScore: breakdown.base,
    skillsMatched: skills.matched,
    skillsMissing: skills.missing,
    technologiesMatched: tech.matched,
    technologiesMissing: tech.missing,
    certificationsMatched: certs.matched,
    certificationsMissing: certs.missing,
    strengths: skills.matched.slice(0, 5),
    aiExplanation: null,
    recommendedFocusAreas: [...skills.missing, ...tech.missing].slice(0, 5),
    isShortlisted: breakdown.total >= opts.threshold,
    matchedAt,
    expiresAt: expiryFor(matchedAt, opts.expiryDays),
    updatedAt: matchedAt,
  };

  return { values, candidate, job, skills, tech, candidateSkills, score: breakdown.total };
}

/**
 * Upsert many match rows in batched round trips. Turso is a remote database, so
 * one statement per candidate is what made the old engine crawl; 50 statements
 * per batch turns a 200-candidate run into 4 round trips.
 */
export async function persistMatches(rows: MatchInsert[]) {
  const CHUNK = 50;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const statements = rows.slice(i, i + CHUNK).map((values) => {
      const { id: _id, ...set } = values;
      return db
        .insert(schema.cvJdMatches)
        .values(values)
        .onConflictDoUpdate({
          target: [schema.cvJdMatches.candidateId, schema.cvJdMatches.jdId],
          set,
        });
    });
    if (!statements.length) continue;
    await db.batch(statements as [(typeof statements)[number], ...typeof statements]);
  }
}

/** Run `worker` over `items` with bounded concurrency. */
export async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await worker(items[index]!);
    }
  });
  await Promise.all(runners);
  return out;
}

/** Add AI narrative to the given built matches, in parallel. */
export async function explainMatches(built: BuiltMatch[]) {
  await mapLimit(built, 5, async (entry) => {
    try {
      const result = await explainMatch({
        jobTitle: entry.job.title,
        jdSummary: entry.job.parsed?.summary ?? entry.job.jdText?.slice(0, 800) ?? "",
        candidateHeadline: `${entry.candidate.headline ?? "Candidate"} — ${entry.candidate.experienceYears ?? "?"} yrs, skills: ${entry.candidateSkills.slice(0, 20).join(", ")}`,
        score: entry.score,
        matchedSkills: entry.skills.matched,
        missingSkills: entry.skills.missing,
        missingTech: entry.tech.missing,
        experienceYears: entry.candidate.experienceYears ?? null,
        requiredExperience: entry.job.parsed?.minExperienceYears ?? null,
      });
      entry.values.aiExplanation = result.explanation;
      entry.values.strengths = result.strengths.length ? result.strengths : entry.values.strengths;
      entry.values.recommendedFocusAreas = result.recommendedFocusAreas.length
        ? result.recommendedFocusAreas
        : entry.values.recommendedFocusAreas;
    } catch {
      /* An explanation is a nice-to-have — never fail the run over it. */
    }
  });
}

/**
 * Fire-and-forget narration. The deterministic scores are already persisted and
 * returned to the caller, so the AI pass runs after the response and patches the
 * rows in place — a full-pool run feels instant instead of waiting on the model.
 */
export function explainInBackground(built: BuiltMatch[]) {
  if (!built.length) return;
  void (async () => {
    try {
      await explainMatches(built);
      const statements = built.map((entry) =>
        db
          .update(schema.cvJdMatches)
          .set({
            aiExplanation: entry.values.aiExplanation,
            strengths: entry.values.strengths,
            recommendedFocusAreas: entry.values.recommendedFocusAreas,
          })
          .where(
            and(
              eq(schema.cvJdMatches.candidateId, entry.candidate.id),
              eq(schema.cvJdMatches.jdId, entry.job.id),
            ),
          ),
      );
      await db.batch(statements as [(typeof statements)[number], ...typeof statements]);
    } catch {
      /* Narration is a nice-to-have — the scores are already saved. */
    }
  })();
}

/**
 * The candidate pool a JD is matched against. A candidate qualifies when the CV
 * produced *something* usable — a vector or extracted skills — so a partially
 * parsed CV still ranks instead of silently disappearing from every result.
 */
export function poolFilter(agencyId: string) {
  return and(
    eq(schema.candidates.agencyId, agencyId),
    eq(schema.candidates.isBlacklisted, false),
    sql`${schema.candidates.currentStatus} not in ('blacklisted','hired','rejected')`,
    sql`${schema.candidates.isDuplicateOf} is null`,
    sql`(${schema.candidates.parseStatus} = 'parsed' or ${schema.candidates.cvVector} is not null or ${schema.candidates.skillsExtracted} is not null)`,
  );
}

