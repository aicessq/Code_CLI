import type { ModelProfile } from "../llm/model_profile.js";

export const OPENAI_DEFAULT: ModelProfile = {
  name: "gpt-4o",
  provider: "openai",

  contextWindow: 128_000,
  maxOutputTokens: 16384,

  supportsToolCalls: true,
  supportsParallelToolCalls: true,
  supportsStreaming: true,
  supportsThinking: false,

  requiresReasoningContentReplay: false,
  reasoningContentField: null,

  defaultTemperature: 0.2,
  defaultTopP: 1.0,

  preferredToolSchemaStyle: "standard_json_schema",
  maxObservationTokens: 6000,

  promptProfile: "generic_coding_agent",
};
