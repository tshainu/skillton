import { createGateway } from "ai";

export const gateway = createGateway({
  baseURL: process.env.AI_GATEWAY_BASE_URL,
  apiKey: process.env.AI_GATEWAY_API_KEY,
});

/*
 * Both roles run on sol. Luna reasoned poorly on interview transcripts — it
 * padded thin evidence into confident scores, which is the one failure mode
 * grading cannot have — and terra was the interim replacement.
 *
 * Model ids are exact: the gateway rejects anything it does not know outright
 * ("Model '...' not found"), so verify a new id against the gateway before
 * shipping it rather than guessing at the spelling.
 */

/** Fast model for parsing and structured extraction. */
export const PARSE_MODEL = "openai/gpt-5.6-sol";
/** Reasoning model for grading, match explanations, reports and the copilot. */
export const REASON_MODEL = "openai/gpt-5.6-sol";
