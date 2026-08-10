import { createGateway } from "ai";

export const gateway = createGateway({
  baseURL: process.env.AI_GATEWAY_BASE_URL,
  apiKey: process.env.AI_GATEWAY_API_KEY,
});

/*
 * Both roles run on terra. Luna reasoned poorly on interview transcripts —
 * it padded thin evidence into confident scores, which is the one failure mode
 * grading cannot have.
 */

/** Fast model for parsing and structured extraction. */
export const PARSE_MODEL = "openai/gpt-5.6-terra";
/** Reasoning model for grading, match explanations, reports and the copilot. */
export const REASON_MODEL = "openai/gpt-5.6-terra";
