import type { Tool, ToolContext } from "./base.js";
import type { ToolResult } from "../llm/message.js";

export interface FinishCallback {
  (summary: string): void;
}

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
