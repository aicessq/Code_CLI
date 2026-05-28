import type { ModelProfile } from "../llm/model_profile.js";

/**
 * OpenAI GPT-4o 模型 profile。
 *
 * OpenAI 的多模态旗舰模型，特点：
 * - 128K 上下文，标准的 OpenAI 上下文窗口
 * - 支持并行工具调用（一次返回多个 tool_calls）
 * - 不支持 thinking（无 reasoning_content）
 * - 使用 standard_json_schema 工具格式（OpenAI 原生格式）
 * - temperature 0.2：较低温度，输出更确定性
 */
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
