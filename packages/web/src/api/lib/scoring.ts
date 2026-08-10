import type { AgencySettings } from "../database/schema";

export const DAY_MS = 86_400_000;

/* ------------------------------------------------ 60-day score expiry rules */

export function expiryFor(matchedAt: Date, days: number): Date {
  return new Date(matchedAt.getTime() + days * DAY_MS);
}

export function isExpired(expiresAt: Date | null | undefined, at: Date = new Date()): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() <= at.getTime();
}

export function daysUntilExpiry(expiresAt: Date | null | undefined, at: Date = new Date()): number {
  if (!expiresAt) return 0;
  return Math.max(0, Math.ceil((expiresAt.getTime() - at.getTime()) / DAY_MS));
}

/**
 * A match row as it should be exposed to any client. Expired matches keep the
 * row (so the candidate stays visible) but the numeric score and every
 * score-derived field are stripped — the UI shows "Score expired — re-run match"
 * and expired rows are excluded from all ranking, search and matching results.
 */
export interface ScoreView<T> {
  expired: boolean;
  daysLeft: number;
  score: number | null;
  match: T;
}

export function viewMatch<T extends { matchScore: number; expiresAt: Date | null }>(
  match: T,
  at: Date = new Date(),
): ScoreView<T> {
  const expired = isExpired(match.expiresAt, at);
  return {
    expired,
    daysLeft: daysUntilExpiry(match.expiresAt, at),
    score: expired ? null : round(match.matchScore),
    match,
  };
}

/* --------------------------------------------------------- scoring formula */

export interface ScoreInput {
  similarity: number;
  requiredSkills: string[];
  matchedSkills: string[];
  candidateExperience: number | null;
  requiredExperience: number | null;
  candidateEducation: string[];
  requiredEducation: string | null;
  candidateLocation: string | null;
  jobLocation: string | null;
}

export interface ScoreBreakdown {
  base: number;
  skillBonus: number;
  experienceBonus: number;
  educationBonus: number;
  locationBonus: number;
  total: number;
}

const DEGREE_RANK: Record<string, number> = {
  diploma: 1,
  associate: 1,
  bachelor: 2,
  bsc: 2,
  be: 2,
  btech: 2,
  master: 3,
  msc: 3,
  mba: 3,
  mtech: 3,
  phd: 4,
  doctorate: 4,
};

function degreeRank(text: string): number {
  const lower = text.toLowerCase();
  let best = 0;
  for (const [key, rank] of Object.entries(DEGREE_RANK)) {
    if (lower.includes(key)) best = Math.max(best, rank);
  }
  return best;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * FINAL = BASE (cosine × 100, weighted to 75) + SKILL (0-15) + EXPERIENCE (0-5)
 *         + EDUCATION (0-5) + LOCATION (0-5). Capped 0-100.
 */
export function computeMatchScore(input: ScoreInput): ScoreBreakdown {
  const base = Math.max(0, Math.min(75, input.similarity * 100 * 0.75));

  const required = input.requiredSkills.length;
  const skillBonus = required === 0 ? 10 : (input.matchedSkills.length / required) * 15;

  let experienceBonus = 0;
  if (input.requiredExperience == null) {
    experienceBonus = 3;
  } else if (input.candidateExperience != null) {
    const diff = Math.abs(input.candidateExperience - input.requiredExperience);
    if (input.candidateExperience >= input.requiredExperience) {
      experienceBonus = diff <= 2 ? 5 : diff <= 5 ? 4 : 3;
    } else {
      experienceBonus = diff <= 1 ? 3 : diff <= 3 ? 1 : 0;
    }
  }

  let educationBonus = 0;
  if (!input.requiredEducation) {
    educationBonus = 2.5;
  } else {
    const need = degreeRank(input.requiredEducation);
    const have = Math.max(0, ...input.candidateEducation.map(degreeRank));
    if (need === 0) educationBonus = 2.5;
    else if (have === need) educationBonus = 5;
    else if (have > need) educationBonus = 3;
    else if (have > 0) educationBonus = 1;
  }

  let locationBonus = 0;
  const jobLoc = (input.jobLocation ?? "").toLowerCase();
  const candLoc = (input.candidateLocation ?? "").toLowerCase();
  if (!jobLoc || jobLoc.includes("remote")) {
    locationBonus = 3;
  } else if (candLoc) {
    const jobParts = jobLoc.split(/[,/]/).map((p) => p.trim()).filter(Boolean);
    const candParts = candLoc.split(/[,/]/).map((p) => p.trim()).filter(Boolean);
    if (jobParts.some((p) => candParts.includes(p))) locationBonus = 5;
    else if (jobParts.some((p) => candLoc.includes(p) || p.includes(candParts[0] ?? "@"))) locationBonus = 2;
  }

  const total = Math.max(0, Math.min(100, base + skillBonus + experienceBonus + educationBonus + locationBonus));

  return {
    base: round(base),
    skillBonus: round(skillBonus),
    experienceBonus: round(experienceBonus),
    educationBonus: round(educationBonus),
    locationBonus: round(locationBonus),
    total: round(total),
  };
}

/** Final candidate score: match × 0.20 + technical × 0.80 (PRD §9). */
export function finalScore(
  matchScore: number | null,
  techScore: number | null,
  settings: Pick<AgencySettings, "matchWeight" | "techWeight">,
): number | null {
  if (techScore == null) return null;
  const match = matchScore ?? 0;
  return round(match * settings.matchWeight + techScore * settings.techWeight);
}

/** Case/format-insensitive skill overlap. */
export function overlap(required: string[], have: string[]) {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#.]/g, "");
  const haveSet = new Set(have.map(norm).filter(Boolean));
  const matched: string[] = [];
  const missing: string[] = [];
  for (const item of required) {
    const key = norm(item);
    if (!key) continue;
    const hit =
      haveSet.has(key) ||
      [...haveSet].some((h) => (h.length > 3 && key.length > 3) && (h.includes(key) || key.includes(h)));
    if (hit) matched.push(item);
    else missing.push(item);
  }
  return { matched, missing };
}
