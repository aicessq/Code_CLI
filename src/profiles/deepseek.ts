import type { ModelProfile } from "../llm/model_profile.js";

export const DEEPSEEK_V3: ModelProfile = {
  name: "deepseek-v3",
  provider: "deepseek",

  contextWindow: 128_000,
  maxOutputTokens: 8192,

  supportsToolCalls: true,
  supportsParallelToolCalls: false,
  supportsStreaming: true,
  supportsThinking: true,

  requiresReasoningContentReplay: true,
  reasoningContentField: "reasoning_content",

  defaultTemperature: 0.3,
  defaultTopP: 0.95,

  preferredToolSchemaStyle: "standard_json_schema",
  maxObservationTokens: 6000,

  promptProfile: "generic_coding_agent",
};
