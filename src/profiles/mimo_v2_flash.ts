import type { ModelProfile } from "../llm/model_profile.js";

export const MIMO_V2_FLASH: ModelProfile = {
  name: "mimo-v2-flash",
  provider: "mimo",

  contextWindow: 256_000,
  maxOutputTokens: 8192,

  supportsToolCalls: true,
  supportsParallelToolCalls: false,
  supportsStreaming: true,
  supportsThinking: true,

  requiresReasoningContentReplay: true,
  reasoningContentField: "reasoning_content",

  defaultTemperature: 0.3,
  defaultTopP: 0.95,

  preferredToolSchemaStyle: "flat_json_schema",
  maxObservationTokens: 4000,

  promptProfile: "mimo_fast_agent",
};
