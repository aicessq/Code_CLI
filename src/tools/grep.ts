import type { Tool, ToolContext } from "./base.js";
import type { ToolResult } from "../llm/message.js";

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
