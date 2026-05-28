import { mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ChatResult, ToolCall, ToolResult } from "../llm/message.js";
import type { AgentState } from "../agent/state.js";

/** 工具调用日志条目结构 */
export interface ToolCallLogEntry {
  step: number;
  toolCall: { id: string; name: string; arguments: Record<string, unknown> };
  result: { content: string; isError: boolean; truncated: boolean };
  timestamp: string;
}

/**
 * Agent 运行轨迹日志记录器。
 *
 * 将每次 agent 运行的详细信息记录为 JSONL 文件，用于调试和评估。
 * 每次运行创建一个以时间戳命名的目录，包含：
 * - messages.jsonl: assistant 消息日志（含 token 使用和 reasoning 状态）
 * - tool_calls.jsonl: 工具调用日志（含参数和结果）
 * - metrics.json: 运行汇总指标（总步数、工具调用数、错误数、token 消耗等）
 */
export class TrajectoryLogger {
  readonly outputDir: string;
  private metrics = {
    totalSteps: 0,
    toolCallsMade: 0,
    errorToolCalls: 0,
    repairsAttempted: 0,
    totalTokens: 0,
    reasoningContentPresent: false,
    assistantTurns: 0,
  };

  constructor(baseDir: string) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    this.outputDir = join(baseDir, timestamp);
    mkdirSync(this.outputDir, { recursive: true });
  }

  /** 记录 assistant 消息（每步一次） */
  logAssistantTurn(step: number, result: ChatResult): void {
    this.metrics.assistantTurns++;
    this.metrics.totalSteps = step + 1;

    if (result.assistantMessage.reasoningContent) {
      this.metrics.reasoningContentPresent = true;
    }

    if (result.usage) {
      this.metrics.totalTokens += result.usage.totalTokens;
    }

    const entry = {
      step,
      role: "assistant" as const,
      content: result.content,
      toolCalls: result.toolCalls.map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.arguments })),
      hasReasoningContent: !!result.assistantMessage.reasoningContent,
      usage: result.usage,
      timestamp: new Date().toISOString(),
    };

    appendFileSync(join(this.outputDir, "messages.jsonl"), JSON.stringify(entry) + "\n");
  }

  /** 记录工具调用（每次工具执行一次） */
  logToolCall(step: number, call: ToolCall, result: ToolResult): void {
    this.metrics.toolCallsMade++;
    if (result.isError) this.metrics.errorToolCalls++;

    const entry: ToolCallLogEntry = {
      step,
      toolCall: { id: call.id, name: call.name, arguments: call.arguments },
      result: { content: result.content, isError: result.isError, truncated: false },
      timestamp: new Date().toISOString(),
    };

    appendFileSync(join(this.outputDir, "tool_calls.jsonl"), JSON.stringify(entry) + "\n");
  }

  /** 写入最终汇总指标（任务结束时调用） */
  writeFinal(state: AgentState): void {
    const metricsData = {
      ...this.metrics,
      finished: state.isFinished(),
      summary: state.summary,
      totalMessages: state.messages.length,
      timestamp: new Date().toISOString(),
    };

    writeFileSync(join(this.outputDir, "metrics.json"), JSON.stringify(metricsData, null, 2));
  }
}
