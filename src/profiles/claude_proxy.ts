import type { ModelProfile } from "../llm/model_profile.js";

/**
 * Claude Sonnet 4 模型 profile（通过代理访问）。
 *
 * Anthropic 的 Claude 模型，通过 OpenAI 兼容代理访问，特点：
 * - 200K 上下文
 * - 支持并行工具调用
 * - 不支持 thinking（代理层不传递 reasoning_content）
 * - 使用 standard_json_schema 工具格式
 * - temperature 0.2：较低温度，输出更确定性
 */
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
