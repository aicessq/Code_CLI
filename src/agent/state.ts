import type { AgentMessage, AssistantMessage, ToolCall, ToolResult } from "../llm/message.js";
import type { ToolContext } from "../tools/base.js";

/**
 * Agent 可变状态容器。
 *
 * 管理单次任务执行过程中的所有状态：
 * - messages: 完整的对话历史（system/user/assistant/tool 消息）
 * - stepCount: 已执行的 assistant 步数（每条 assistant 消息算一步）
 * - finished: 任务是否已完成（模型调用 finish 工具时设为 true）
 * - summary: 任务完成摘要
 * - toolContext: 工具执行上下文（工作目录 + 沙箱实例）
 *
 * 设计为可变对象，在 agent loop 中原地更新，避免不必要的状态传递。
 */
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

  /** 添加 assistant 消息并递增步数计数器 */
  addAssistantMessage(msg: AssistantMessage): void {
    this.messages.push(msg);
    this.stepCount++;
  }

  /** 将工具执行结果添加为 tool 角色消息 */
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
