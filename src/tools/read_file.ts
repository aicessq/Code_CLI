import type { Tool, ToolContext } from "./base.js";
import type { ToolResult } from "../llm/message.js";

/**
 * 文件读取工具。
 * 读取文件内容，支持可选的行范围（start_line/end_line，1-indexed，闭区间）。
 * 通过 sandbox.readFile() 实现，支持大文件的部分读取。
 */
export const readFileTool: Tool = {
  schema: {
    name: "read_file",
    description: "Read the contents of a file, optionally within a line range",
    parameters: [
      {
        name: "path",
        type: "string",
        description: "File path to read (relative to working directory)",
        required: true,
      },
      {
        name: "start_line",
        type: "integer",
        description: "First line to read (1-indexed, inclusive)",
        required: false,
      },
      {
        name: "end_line",
        type: "integer",
        description: "Last line to read (1-indexed, inclusive)",
        required: false,
      },
    ],
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const path = String(args.path);
    const startLine = args.start_line != null ? Number(args.start_line) : undefined;
    const endLine = args.end_line != null ? Number(args.end_line) : undefined;

    const content = await context.sandbox.readFile(path, startLine, endLine);

    return {
      toolCallId: "",
      name: "read_file",
      content,
      isError: false,
    };
  },
};
