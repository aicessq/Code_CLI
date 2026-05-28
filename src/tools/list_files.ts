import type { Tool, ToolContext } from "./base.js";
import type { ToolResult } from "../llm/message.js";

/**
 * 目录列表工具。
 * 列出指定路径下的文件和目录，通过 sandbox.listFiles() 实现。
 * 路径相对于工作目录解析。
 */
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
