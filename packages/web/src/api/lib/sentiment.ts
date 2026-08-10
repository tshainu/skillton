import { z } from "zod";
import { generateObject } from "ai";
import dedent from "dedent";
import { gateway, PARSE_MODEL } from "../agent/gateway";

/**
 * Interviewer-comment sentiment.
 *
 * The rated parameters give the raw score; the interviewer's written comment
 * often carries signal the rating grid missed ("outstanding system design
 * instincts", "kept guessing on basics"). This nudges the final technical score
 * by at most ±MAX_ADJUSTMENT points so a comment can shade a result without
 * overturning the rated evidence.
 */

export const MAX_ADJUSTMENT = 8;

const schema = z.object({
  sentiment: z.enum(["positive", "negative", "neutral"]),
  /** -1 (strongly negative) to +1 (strongly positive). */
  strength: z.number().min(-1).max(1),
  rationale: z.string().max(300),
});

export interface SentimentResult {
  sentiment: "positive" | "negative" | "neutral";
  adjustment: number;
  rationale: string | null;
}

const POSITIVE = [
  "excellent","outstanding","strong","impressive","exceptional","great","solid","confident",
  "clear","thorough","proactive","knowledgeable","recommend","brilliant","sharp","mature",
];
const NEGATIVE = [
  "weak","poor","struggled","unclear","confused","lacking","gaps","shallow","hesitant",
  "unable","failed","concern","worrying","superficial","not ready","guessing","vague",
];

/** Keyword fallback used when the model is unavailable. */
export function keywordSentiment(comment: string): SentimentResult {
  const text = comment.toLowerCase();
  let score = 0;
  for (const word of POSITIVE) if (text.includes(word)) score++;
  for (const word of NEGATIVE) if (text.includes(word)) score--;
  if (score === 0) return { sentiment: "neutral", adjustment: 0, rationale: null };

  const strength = Math.max(-1, Math.min(1, score / 4));
  return {
    sentiment: score > 0 ? "positive" : "negative",
    adjustment: Math.round(strength * MAX_ADJUSTMENT * 10) / 10,
    rationale: `Keyword analysis found ${score > 0 ? "positive" : "negative"} language in the comment.`,
  };
}

/**
 * Classify an interviewer comment and return the point adjustment to apply to
 * the technical score. Always resolves — never throws at the caller.
 */
export async function scoreComment(comment: string | undefined | null): Promise<SentimentResult> {
  const text = (comment ?? "").trim();
  if (text.length < 12) return { sentiment: "neutral", adjustment: 0, rationale: null };

  try {
    const { object } = await generateObject({
      model: gateway(PARSE_MODEL),
      schema,
      prompt: dedent`
        You are calibrating a technical interview score. Read the interviewer's
        written comment and judge how positive or negative it is about the
        candidate's technical ability.

        Return:
        - sentiment: positive, negative or neutral
        - strength: -1 to +1. Use the extremes only for unambiguous praise or
          unambiguous criticism. Mild or mixed comments belong near 0.
        - rationale: one sentence quoting the decisive wording.

        Judge only the candidate's performance. Ignore scheduling notes, logistics
        and remarks about the process.

        COMMENT:
        ${text.slice(0, 4000)}
      `,
    });

    const adjustment =
      object.sentiment === "neutral"
        ? 0
        : Math.round(object.strength * MAX_ADJUSTMENT * 10) / 10;

    return { sentiment: object.sentiment, adjustment, rationale: object.rationale };
  } catch {
    return keywordSentiment(text);
  }
}
