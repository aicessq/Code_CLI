import type { ModelProfile } from "../llm/model_profile.js";

export const MIMO_V25_PRO: ModelProfile = {
  name: "mimo-v25-pro",
  provider: "mimo",

  contextWindow: 1_000_000,
  maxOutputTokens: 16384,

  supportsToolCalls: true,
  supportsParallelToolCalls: false,
  supportsStreaming: true,
  supportsThinking: true,

  requiresReasoningContentReplay: true,
  reasoningContentField: "reasoning_content",

  defaultTemperature: 1.0,
  defaultTopP: 0.95,

  preferredToolSchemaStyle: "flat_json_schema",
  maxObservationTokens: 8000,

  promptProfile: "mimo_coding_agent",
};
