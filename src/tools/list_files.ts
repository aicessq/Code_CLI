import type { Tool, ToolContext } from "./base.js";
import type { ToolResult } from "../llm/message.js";

export const listFilesTool: Tool = {
  schema: {
    name: "list_files",
    description: "List files and directories in a given path",
    parameters: [
      {
        name: "path",
        type: "string",
        description: "Directory path to list (relative to working directory)",
        required: true,
      },
    ],
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const path = String(args.path || ".");
    const files = await context.sandbox.listFiles(path);

    return {
      toolCallId: "",
      name: "list_files",
      content: files.join("\n"),
      isError: false,
    };
  },
};
