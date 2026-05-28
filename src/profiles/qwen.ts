import type { ModelProfile } from "../llm/model_profile.js";

export const QWEN_MAX: ModelProfile = {
  name: "qwen-max",
  provider: "qwen",

  contextWindow: 131_072,
  maxOutputTokens: 8192,

  supportsToolCalls: true,
  supportsParallelToolCalls: false,
  supportsStreaming: true,
  supportsThinking: false,

  requiresReasoningContentReplay: false,
  reasoningContentField: null,

  defaultTemperature: 0.3,
  defaultTopP: 0.9,

  preferredToolSchemaStyle: "standard_json_schema",
  maxObservationTokens: 6000,

  promptProfile: "generic_coding_agent",
};
