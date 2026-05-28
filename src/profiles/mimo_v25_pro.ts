import type { ModelProfile } from "../llm/model_profile.js";

/**
 * MiMo V2.5 Pro 模型 profile。
 *
 * MiMo V2 的升级版本，参数与 V2 Pro 基本一致。
 * 主要改进在模型本身的能力，profile 配置保持兼容。
 */
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
