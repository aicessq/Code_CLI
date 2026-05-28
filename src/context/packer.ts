/**
 * ContextPacker - 上下文打包器
 *
 * 负责将 AgentState 中的消息列表打包为符合模型 token 预算的消息列表。
 * 这是长任务能够持续运行的关键组件。
 *
 * 核心策略:
 * - 始终保留 system message
 * - 从最新消息向前遍历，直到预算耗尽
 * - 如果最近的消息对超出预算，截断内容而非丢弃
 * - 插入标记: "[Earlier messages omitted to fit context window]"
 *
 * MiMo 关键规则:
 * - 绝不截断 reasoningContent（MiMo 要求完整回传）
 * - 如果保留一条消息会因为其 reasoningContent 超出预算，
 *   则丢弃更旧的消息，而不是截断 reasoningContent
 *
 * Token 预算计算:
 *   可用 Token = contextWindow - maxOutputTokens - 2000 (安全余量)
 *
 * 注意: 此模块已实现但尚未集成到 Agent Loop 中。
 * 当前 Agent Loop 直接使用 state.messages，可能导致长任务的上下文溢出。
 */
import type { AgentMessage, AssistantMessage } from "../llm/message.js";
import type { ModelProfile } from "../llm/model_profile.js";
import type { AgentState } from "../agent/state.js";
import { TokenCounter } from "./token_counter.js";

export class ContextPacker {
  private tokenCounter: TokenCounter;

  constructor() {
    this.tokenCounter = new TokenCounter();
  }

  /**
   * 构建符合 token 预算的消息列表
   *
   * @param state - Agent 状态（包含完整消息历史）
   * @param profile - 模型 Profile（决定 token 预算）
   * @returns 符合预算的消息列表
   */
  build(state: AgentState, profile: ModelProfile): AgentMessage[] {
    const messages = state.messages;
    if (messages.length === 0) return [];

    // 计算 token 预算
    // contextWindow: 模型的上下文窗口大小
    // maxOutputTokens: 预留给输出的 token 数
    // safetyMargin: 安全余量（防止边界情况）
    const safetyMargin = 2000;
    const budget = profile.contextWindow - profile.maxOutputTokens - safetyMargin;

    // 始终保留 system message（第一条消息）
    const systemMsg = messages[0];
    const result: AgentMessage[] = [systemMsg];
    let usedTokens = this.tokenCounter.countMessage(systemMsg);

    // 从最新消息向前遍历
    const rest = messages.slice(1);
    const included: AgentMessage[] = [];

    for (let i = rest.length - 1; i >= 0; i--) {
      const msg = rest[i];
      const msgTokens = this.tokenCounter.countMessage(msg);

      if (usedTokens + msgTokens <= budget) {
        // 预算充足，保留完整消息
        included.unshift(msg);
        usedTokens += msgTokens;
      } else if (i >= rest.length - 2) {
        // 最近的 2 条消息（assistant + tool_result）必须保留
        // 截断内容而非丢弃
        const truncated = this.truncateMessage(msg, budget - usedTokens);
        if (truncated) {
          included.unshift(truncated);
          usedTokens += this.tokenCounter.countMessage(truncated);
        }
        break;
      } else {
        // 预算耗尽，插入省略标记
        included.unshift({
          role: "user",
          content: "[Earlier messages omitted to fit context window]",
        });
        break;
      }
    }

    result.push(...included);
    return result;
  }

  /**
   * 截断消息内容以适应可用 token 数
   *
   * 截断策略（按消息类型）:
   * - tool: 截断 content
   * - assistant: 截断 content，但绝不截断 reasoningContent
   * - user: 截断 content
   *
   * 关键: 对于 AssistantMessage，如果有 reasoningContent，
   * 只截断 main content，绝不截断 reasoningContent。
   * 这是 MiMo 协议的硬性要求。
   */
  private truncateMessage(msg: AgentMessage, availableTokens: number): AgentMessage | null {
    if (availableTokens <= 0) return null;

    switch (msg.role) {
      case "tool": {
        // 截断工具结果内容
        const maxChars = availableTokens * 3; // 粗略估计: ~3 字符/token
        return {
          ...msg,
          content: msg.content.slice(0, maxChars) + "\n[truncated]",
        };
      }
      case "assistant": {
        // ⚠️ 绝不截断 reasoningContent
        const assistantMsg = msg as AssistantMessage;
        if (assistantMsg.reasoningContent) {
          // 只截断 main content
          const maxChars = availableTokens * 3;
          const contentChars = assistantMsg.content?.length ?? 0;
          if (contentChars > maxChars) {
            return {
              ...assistantMsg,
              content: (assistantMsg.content?.slice(0, maxChars) ?? "") + "\n[truncated]",
            };
          }
        }
        return msg;
      }
      case "user": {
        const maxChars = availableTokens * 3;
        if (msg.content.length > maxChars) {
          return {
            ...msg,
            content: msg.content.slice(0, maxChars) + "\n[truncated]",
          };
        }
        return msg;
      }
      default:
        return msg;
    }
  }
}
