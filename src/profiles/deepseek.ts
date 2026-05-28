import type { ModelProfile } from "../llm/model_profile.js";

/**
 * DeepSeek V3 模型 profile。
 *
 * DeepSeek 的旗舰模型，特点：
 * - 支持 thinking（reasoning_content），需要 replay（与 MiMo 相同协议）
 * - 128K 上下文
 * - 不支持并行工具调用
 * - 使用 standard_json_schema 工具格式（与 MiMo 不同）
 * - temperature 0.3：适中的温度
 */
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
