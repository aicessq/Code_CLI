import type { AgentMessage, AssistantMessage, ToolCall, ToolResult } from "../llm/message.js";
import type { ToolContext } from "../tools/base.js";

export class AgentState {
  readonly messages: AgentMessage[] = [];
  stepCount = 0;
  finished = false;
  summary: string | null = null;
  toolContext: ToolContext;

  constructor(
    public readonly task: string,
    workingDirectory: string,
    sandbox: import("../sandbox/base.js").Sandbox
  ) {
    this.toolContext = {
      workingDirectory,
      sandbox,
    };
  }

  addSystemMessage(content: string): void {
    this.messages.push({ role: "system", content });
  }

  addUserMessage(content: string): void {
    this.messages.push({ role: "user", content });
  }

  addAssistantMessage(msg: AssistantMessage): void {
    this.messages.push(msg);
    this.stepCount++;
  }

  addToolResult(call: ToolCall, result: ToolResult): void {
    this.messages.push({
      role: "tool",
      toolCallId: call.id,
      content: result.content,
      name: call.name,
    });
  }

  setFinished(summary: string): void {
    this.finished = true;
    this.summary = summary;
  }

  isFinished(): boolean {
    return this.finished;
  }
}
