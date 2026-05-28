import type { Tool, ToolContext } from "./base.js";
import type { ToolResult } from "../llm/message.js";

/** 完成回调类型，接收模型的任务完成摘要 */
export interface FinishCallback {
  (summary: string): void;
}

/**
 * 创建任务完成工具。
 *
 * 使用回调模式：agent loop 在创建 ToolRegistry 时传入回调，
 * 当模型调用 finish 工具时触发回调，通知 agent loop 任务已完成。
 * 这避免了工具对 agent loop 的直接依赖。
 *
 * @param callback - 任务完成时的回调函数，由 runAgent() 注入
 */
export function createFinishTool(callback: FinishCallback): Tool {
  return {
    schema: {
      name: "finish",
      description: "Mark the task as complete and provide a summary of what was done",
      parameters: [
        {
          name: "summary",
          type: "string",
          description: "Summary of the work completed",
          required: true,
        },
      ],
    },

    async execute(args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      const summary = String(args.summary || "Task completed.");
      callback(summary);

      return {
        toolCallId: "",
        name: "finish",
        content: `Task finished: ${summary}`,
        isError: false,
      };
    },
  };
}
