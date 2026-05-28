import type { AgentMessage, ChatResult } from "./message.js";
import type { ModelProfile } from "./model_profile.js";
import type { StreamCallbacks } from "./stream_parser.js";

/**
 * LLM 客户端抽象基类。
 *
 * 所有 LLM 交互的统一接口。agent loop 只依赖此抽象，不直接接触具体 SDK。
 * 具体实现（如 OpenAICompatibleClient）负责 HTTP 通信、序列化和响应解析。
 *
 * 设计原则：
 * - agent 层不感知具体 provider，只通过此接口调用
 * - ModelProfile 传入以支持不同模型的能力差异（流式、工具调用等）
 * - StreamCallbacks 是可选的，不传则静默执行
 */
export abstract class LLMClient {
  /**
   * 发送对话请求并获取模型响应。
   *
   * @param messages - 对话历史（AgentMessage[]），由 TranscriptSerializer 序列化为 wire format
   * @param tools - 可用工具列表（已渲染的 ToolSchema），null 表示不使用工具
   * @param profile - 模型能力配置，决定是否包含 reasoning_content、工具格式等
   * @param stream - 是否启用流式输出，启用后通过 callbacks 实时回调 token
   * @param callbacks - 流式回调（onToken/onReasoningToken/onToolCallStart 等），仅 stream=true 时生效
   * @returns ChatResult，包含 assistantMessage、toolCalls、usage 等
   */
  abstract chat(
    messages: AgentMessage[],
    tools: Record<string, unknown>[] | null,
    profile: ModelProfile,
    stream?: boolean,
    callbacks?: StreamCallbacks
  ): Promise<ChatResult>;
}
