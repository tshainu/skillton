/**
 * The candidate pipeline vocabulary. Single source of truth: the API validates
 * against this list and the UI builds its filter dropdown from the same array,
 * so the two cannot drift apart and hand the recruiter a silent HTTP 400.
 */
export const CANDIDATE_STATUSES = [
  "new",
  "shortlisted",
  "hr_screening",
  "hr_selected",
  "hr_hold",
  "hr_rejected",
  "ai_interview_pending",
  "ai_interview_completed",
  "tech_interview_pending",
  "tech_interview_completed",
  "final_review",
  "offered",
  "hired",
  "rejected",
  "blacklisted",
] as const;

export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export const CANDIDATE_STAGES = [
  "screening",
  "ai_interview",
  "tech_interview",
  "client_review",
  "decision",
] as const;

export type CandidateStage = (typeof CANDIDATE_STAGES)[number];

export function isCandidateStatus(value: string): value is CandidateStatus {
  return (CANDIDATE_STATUSES as readonly string[]).includes(value);
}
