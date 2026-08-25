/**
 * The AI voice interview runs one of two named, switchable profiles.
 *
 * "original" — ORIGINAL_VOICE: everything the interviewer has said in
 *   production up to now. It lives untouched in `../interview-prompt.ts`; this
 *   module only selects it. Nothing here rewrites, patches or regenerates it, so
 *   switching back to the original voice is provably lossless.
 *
 * "test" — TEST_VOICE: the experimental spec in `./test.ts` (fixed five-question
 *   IT screening, its own pacing and acknowledgement rules).
 *
 * Which one runs is an agency setting (`aiVoiceProfile`), so it flips live
 * without a deploy. This file is composition only.
 */
import type { AiQuestion } from "../../database/schema";
import { buildInterviewInstructions, interviewQuestions } from "../interview-prompt";
import type { InterviewPromptInput } from "../interview-prompt";
import { buildTestVoiceInstructions, testVoiceQuestions } from "./test";

export type VoiceProfile = "original" | "test";

export const VOICE_PROFILES: { value: VoiceProfile; label: string; hint: string }[] = [
  {
    value: "original",
    label: "Original Voice",
    hint: "The production interviewer: the recruiter's own question set, warm acknowledgements, 2 follow-ups per interview.",
  },
  {
    value: "test",
    label: "Test Voice",
    hint: "Experimental: fixed five-question IT screening, neutral acknowledgements, 1.5s transitions, strict no-interrupt pacing.",
  },
];

export function isVoiceProfile(value: unknown): value is VoiceProfile {
  return value === "original" || value === "test";
}

export function resolveVoiceProfile(value: unknown): VoiceProfile {
  return isVoiceProfile(value) ? value : "original";
}

/**
 * The questions the interview will actually ask, under the given profile.
 *
 * Test Voice ignores the recruiter's set entirely — its five questions are the
 * whole point of the spec. Original Voice slices the recruiter's set to its cap.
 * Either way the caller gets the definitive list, so the room's coverage
 * tracking and the grader count the same questions the model was given.
 */
export function profileQuestions(profile: VoiceProfile, recruiterSet: AiQuestion[]): AiQuestion[] {
  return profile === "test" ? testVoiceQuestions() : interviewQuestions(recruiterSet);
}

export function profileInstructions(profile: VoiceProfile, input: InterviewPromptInput): string {
  return profile === "test" ? buildTestVoiceInstructions(input) : buildInterviewInstructions(input);
}

export { CLARIFICATION_CAP, TEST_VOICE_QUESTIONS, TRANSITION_PAUSE_SECONDS } from "./test";
