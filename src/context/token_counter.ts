import { encodingForModel } from "js-tiktoken";
import type { AgentMessage } from "../llm/message.js";

/**
 * 基于 tiktoken 的 token 计数器。
 * 使用 cl100k_base 编码（GPT-4o 使用的编码），适用于所有 OpenAI 兼容 API。
 * 用于 ContextPacker 的 token 预算管理。
 */
export class TokenCounter {
  private encoder: ReturnType<typeof encodingForModel>;

  constructor() {
    this.encoder = encodingForModel("gpt-4o"); // cl100k_base encoding
  }

  /** 计算纯文本的 token 数 */
  count(text: string): number {
    if (!text) return 0;
    return this.encoder.encode(text).length;
  }

  /**
   * 计算单条 AgentMessage 的 token 数。
   * 将消息的所有文本内容（content、toolCalls、reasoningContent）拼接后计数，
   * 并加上 4 token 的消息格式开销（role、分隔符等）。
   */
  countMessage(msg: AgentMessage): number {
    let text = "";
    switch (msg.role) {
      case "system":
        text = msg.content;
        break;
      case "user":
        text = msg.content;
        break;
      case "assistant":
        text = msg.content ?? "";
        for (const tc of msg.toolCalls) {
          text += ` ${tc.name} ${JSON.stringify(tc.arguments)}`;
        }
        if (msg.reasoningContent) {
          text += ` ${msg.reasoningContent}`;
        }
        break;
      case "tool":
        text = msg.content;
        break;
    }
    // 每条消息有 4 token 的格式开销
    return this.count(text) + 4;
  }

  /** 计算整个消息列表的总 token 数 */
  countMessages(messages: AgentMessage[]): number {
    let total = 0;
    for (const msg of messages) {
      total += this.countMessage(msg);
    }
    return total;
  }
}
