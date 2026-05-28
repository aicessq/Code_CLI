import type { Tool, ToolContext } from "./base.js";
import type { ToolResult } from "../llm/message.js";

export const bashTool: Tool = {
  schema: {
    name: "bash",
    description: "Run a shell command in the sandbox",
    parameters: [
      {
        name: "cmd",
        type: "string",
        description: "The shell command to execute",
        required: true,
      },
      {
        name: "timeout_sec",
        type: "integer",
        description: "Timeout in seconds (default: 60)",
        required: false,
      },
    ],
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const cmd = String(args.cmd);
    const timeoutSec = args.timeout_sec != null ? Number(args.timeout_sec) : 60;

    const result = await context.sandbox.execute(cmd, { timeoutSec });

    let output = "";
    if (result.stdout) output += result.stdout;
    if (result.stderr) output += (output ? "\n[stderr]\n" : "") + result.stderr;
    if (result.timedOut) output += "\n[command timed out]";
    if (result.truncated) output += "\n[output truncated]";

    return {
      toolCallId: "",
      name: "bash",
      content: output || `(exit code: ${result.exitCode})`,
      isError: result.exitCode !== 0,
    };
  },
};
