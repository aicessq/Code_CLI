import type { ModelProfile } from "../llm/model_profile.js";

/**
 * 通义千问 Max 模型 profile。
 *
 * 阿里云的旗舰模型，特点：
 * - 131K 上下文（略大于标准 128K）
 * - 不支持 thinking（无 reasoning_content）
 * - 不支持并行工具调用
 * - 使用 standard_json_schema 工具格式
 * - temperature 0.3
 */
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
