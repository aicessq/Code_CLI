import type { ModelProfile } from "../llm/model_profile.js";

export const CLAUDE_PROXY: ModelProfile = {
  name: "claude-sonnet-4",
  provider: "claude-proxy",

  contextWindow: 200_000,
  maxOutputTokens: 8192,

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
