import { createGateway } from "ai";

export const gateway = createGateway({
  baseURL: process.env.AI_GATEWAY_BASE_URL,
  apiKey: process.env.AI_GATEWAY_API_KEY,
});

/** Fast, cheap model for parsing and structured extraction. */
export const PARSE_MODEL = "openai/gpt-5.6-luna";
/** Reasoning model for match explanations, reports and the copilot. */
export const REASON_MODEL = "openai/gpt-5.6-luna";
