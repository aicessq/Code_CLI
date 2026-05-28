/**
 * TranscriptSerializer - 消息序列化器
 *
 * 这是模型无关性的核心边界模块。
 * 负责将内部 AgentMessage[] 序列化为 API wire format。
 *
 * 核心职责:
 * 1. 将内部 camelCase 转换为 API snake_case (toolCallId → tool_call_id)
 * 2. 根据 profile 决定是否包含 reasoning_content
 * 3. 将 ToolCall[] 转换为 API 的 tool_calls 格式 (包含 JSON.stringify)
 *
 * 为什么需要这个模块?
 * - 不同模型对消息格式有不同要求
 * - MiMo 需要 reasoning_content，其他模型不需要
 * - 部分模型会拒绝未知字段（如 reasoning_content）
 * - tool_calls 的 arguments 必须是 JSON 字符串（内部是对象）
 *
 * 使用方式:
 *   const serializer = new TranscriptSerializer();
 *   const wireMessages = serializer.serialize(state.messages, profile);
 *   // wireMessages 可以直接发送给 API
 */
import type { AgentMessage, AssistantMessage } from "./message.js";
import type { ModelProfile } from "./model_profile.js";

export class TranscriptSerializer {
  /**
   * 将内部消息列表序列化为 API wire format
   *
   * @param messages - 内部 AgentMessage 列表
   * @param profile - 模型 Profile（决定序列化行为）
   * @returns API wire format 的消息列表
   */
  serialize(messages: AgentMessage[], profile: ModelProfile): Record<string, unknown>[] {
    return messages.map((msg) => this.serializeOne(msg, profile));
  }

  /**
   * 序列化单条消息
   *
   * 根据消息类型分别处理:
   * - system/user: 直接返回 { role, content }
   * - assistant: 委托给 serializeAssistant（最复杂的情况）
   * - tool: 转换 toolCallId → tool_call_id
   */
  private serializeOne(msg: AgentMessage, profile: ModelProfile): Record<string, unknown> {
    switch (msg.role) {
      case "system":
        return { role: "system", content: msg.content };

      case "user":
        return { role: "user", content: msg.content };

      case "assistant":
        return this.serializeAssistant(msg, profile);

      case "tool":
        // 注意: 内部使用 camelCase (toolCallId)，API 要求 snake_case (tool_call_id)
        return {
          role: "tool",
          tool_call_id: msg.toolCallId,
          content: msg.content,
          ...(msg.name ? { name: msg.name } : {}),
        };
    }
  }

  /**
   * 序列化助手消息（最复杂的情况）
   *
   * 处理逻辑:
   * 1. 设置 role: "assistant"
   * 2. 如果有 content，添加到结果
   * 3. 如果有 tool_calls，转换为 API 格式:
   *    - arguments: 对象 → JSON 字符串 (JSON.stringify)
   *    - 每个 tool_call 包含 { id, type: "function", function: { name, arguments } }
   * 4. 如果 profile 要求回传 reasoning_content，且消息中有 reasoningContent:
   *    - 添加 reasoning_content 字段到结果
   *
   * 关键: reasoning_content 只在以下条件同时满足时才包含:
   * - profile.requiresReasoningContentReplay === true
   * - msg.reasoningContent !== null
   *
   * 如果 profile 不要求回传（如 GPT-4o），即使消息中有 reasoningContent 也不包含，
   * 因为部分 provider 会拒绝未知字段。
   */
  private serializeAssistant(msg: AssistantMessage, profile: ModelProfile): Record<string, unknown> {
    const wire: Record<string, unknown> = {
      role: "assistant",
    };

    // content 可能为 null（纯工具调用时）
    if (msg.content !== null) {
      wire.content = msg.content;
    }

    // 转换 tool_calls 为 API 格式
    if (msg.toolCalls.length > 0) {
      wire.tool_calls = msg.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: {
          name: tc.name,
          // 必须将对象序列化为 JSON 字符串（API 要求）
          arguments: JSON.stringify(tc.arguments),
        },
      }));
    }

    // reasoning_content 回传（MiMo/DeepSeek 关键逻辑）
    // 只有当 profile 要求回传 且 消息中有 reasoningContent 时才包含
    if (profile.requiresReasoningContentReplay && msg.reasoningContent !== null) {
      wire.reasoning_content = msg.reasoningContent;
    }

    return wire;
  }
}
