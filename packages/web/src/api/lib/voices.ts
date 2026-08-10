/**
 * Realtime interviewer voice catalogue.
 *
 * The AI interviewer should sound like a real recruiter, so the agency picks a
 * voice explicitly instead of inheriting whatever the API defaults to. Gender is
 * recorded here because "make the interviewer a man" is a normal agency request
 * and the raw OpenAI voice names give no hint either way.
 */

export interface VoiceOption {
  id: string;
  label: string;
  gender: "male" | "female" | "neutral";
  /** How the voice actually reads in an interview, for the settings picker. */
  description: string;
}

/** Voices supported by the GA Realtime models, newest and most natural first. */
export const AI_VOICES: VoiceOption[] = [
  {
    id: "cedar",
    label: "Cedar",
    gender: "male",
    description: "Deep, calm, natural male voice — the most human-sounding option. Recommended.",
  },
  { id: "ash", label: "Ash", gender: "male", description: "Warm, steady male voice with an even pace." },
  { id: "verse", label: "Verse", gender: "male", description: "Bright, energetic male voice." },
  { id: "ballad", label: "Ballad", gender: "male", description: "Softer, thoughtful male voice." },
  { id: "echo", label: "Echo", gender: "male", description: "Crisp, neutral-accent male voice." },
  { id: "marin", label: "Marin", gender: "female", description: "Natural, conversational female voice." },
  { id: "sage", label: "Sage", gender: "female", description: "Measured, professional female voice." },
  { id: "shimmer", label: "Shimmer", gender: "female", description: "Light, upbeat female voice." },
  { id: "coral", label: "Coral", gender: "female", description: "Friendly, expressive female voice." },
  { id: "alloy", label: "Alloy", gender: "neutral", description: "Flat, androgynous voice. Reads robotic." },
];

/** Fallback interviewer voice: a natural male voice. */
export const DEFAULT_AI_VOICE = "cedar";

export const MALE_VOICES = AI_VOICES.filter((v) => v.gender === "male");

export function isSupportedVoice(voice: string | null | undefined): boolean {
  return Boolean(voice) && AI_VOICES.some((v) => v.id === voice);
}

/** Never let a stale or misspelled setting reach the Realtime API. */
export function resolveVoice(voice: string | null | undefined): string {
  return isSupportedVoice(voice) ? (voice as string) : DEFAULT_AI_VOICE;
}
