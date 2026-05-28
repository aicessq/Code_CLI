import type { ModelProfile } from "../llm/model_profile.js";

/**
 * MiMo V2 Flash 模型 profile。
 *
 * MiMo 系列的轻量快速版本，特点：
 * - 256K 上下文（Pro 的 1/4），但足以处理大多数编码任务
 * - maxOutputTokens 8192（Pro 的 1/2），输出更紧凑
 * - temperature 0.3：比 Pro 更低，输出更确定性（适合快速任务）
 * - 使用专用的 mimo_fast_agent prompt（更简洁的指令）
 * - maxObservationTokens 4000：更激进的输出截断
 */
export const MIMO_V2_FLASH: ModelProfile = {
  name: "mimo-v2-flash",
  provider: "mimo",

  contextWindow: 256_000,
  maxOutputTokens: 8192,

  supportsToolCalls: true,
  supportsParallelToolCalls: false,
  supportsStreaming: true,
  supportsThinking: true,

  requiresReasoningContentReplay: true,
  reasoningContentField: "reasoning_content",

  defaultTemperature: 0.3,
  defaultTopP: 0.95,

  preferredToolSchemaStyle: "flat_json_schema",
  maxObservationTokens: 4000,

  promptProfile: "mimo_fast_agent",
};
