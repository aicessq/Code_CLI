import type { Tool, ToolContext } from "./base.js";
import type { ToolResult } from "../llm/message.js";

/**
 * 基于 ripgrep 的文件内容搜索工具。
 * 支持正则表达式，结果限制为 100 行以防止输出过大。
 * 执行策略：先尝试 -l（仅文件名），如有结果则返回文件名；
 * 否则回退到带行号的全文匹配（-n --no-heading），截取前 100 行。
 */
export const grepTool: Tool = {
  schema: {
    name: "grep",
    description: "Search for a pattern in files using ripgrep",
    parameters: [
      {
        name: "pattern",
        type: "string",
        description: "Search pattern (regex supported)",
        required: true,
      },
      {
        name: "path",
        type: "string",
        description: "File or directory to search in (default: current directory)",
        required: false,
      },
    ],
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const pattern = String(args.pattern);
    const path = args.path ? String(args.path) : ".";
    const cmd = `rg -n --no-heading -l "${pattern}" "${path}" 2>/dev/null || rg -n --no-heading "${pattern}" "${path}" 2>&1 | head -100`;

    const result = await context.sandbox.execute(cmd, { timeoutSec: 30 });

    return {
      toolCallId: "",
      name: "grep",
      content: result.stdout || result.stderr || "(no matches)",
      isError: result.exitCode !== 0 && !result.stdout,
    };
  },
};
