import { encodingForModel } from "js-tiktoken";
import type { AgentMessage } from "../llm/message.js";

export class TokenCounter {
  private encoder: ReturnType<typeof encodingForModel>;

  constructor() {
    this.encoder = encodingForModel("gpt-4o"); // cl100k_base encoding
  }

  count(text: string): number {
    if (!text) return 0;
    return this.encoder.encode(text).length;
  }

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
    // Add overhead per message (role, formatting)
    return this.count(text) + 4;
  }

  countMessages(messages: AgentMessage[]): number {
    let total = 0;
    for (const msg of messages) {
      total += this.countMessage(msg);
    }
    return total;
  }
}
