import type { ModelProfile } from "../llm/model_profile.js";

/**
 * MiMo V2 Pro 模型 profile。
 *
 * 小米 MiMo 系列的旗舰编码模型，特点：
 * - 1M 超长上下文窗口，适合处理大型代码库
 * - 支持 thinking（reasoning_content），需要 replay 才能维持多轮对话
 * - 使用 flat_json_schema 工具格式（MiMo 对标准 JSON Schema description 解析不稳定）
 * - temperature 1.0：MiMo 推荐的默认温度，配合 thinking 使用
 */
export const MIMO_V2_PRO: ModelProfile = {
  name: "mimo-v2-pro",
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
