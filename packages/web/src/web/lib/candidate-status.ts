/**
 * Candidate pipeline vocabulary for the UI. Re-exported from the API so a
 * filter dropdown can never offer a status the server's zod enum rejects —
 * that mismatch turned "Interviewing" into a silent HTTP 400 and an empty list.
 */
export {
  CANDIDATE_STAGES,
  CANDIDATE_STATUSES,
  isCandidateStatus,
} from "../../api/lib/candidate-status";
export type { CandidateStage, CandidateStatus } from "../../api/lib/candidate-status";
