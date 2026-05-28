import type { Tool, ToolContext } from "./base.js";
import type { ToolResult } from "../llm/message.js";

/**
 * Git 状态查看工具（git status --short）。
 * 显示工作树的简短状态，包括暂存区和工作目录的变更。
 */

export const gitStatusTool: Tool = {
  schema: {
    name: "git_status",
    description: "Show the current git working tree status",
    parameters: [],
  },

  async execute(_args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const result = await context.sandbox.execute("git status --short", { timeoutSec: 10 });

    return {
      toolCallId: "",
      name: "git_status",
      content: result.stdout || "(clean working tree)",
      isError: result.exitCode !== 0,
    };
  },
};

/**
 * Git diff 查看工具。
 * 默认显示未暂存的变更，传入 staged=true 显示已暂存的变更。
 */

export const gitDiffTool: Tool = {
  schema: {
    name: "git_diff",
    description: "Show the diff of uncommitted changes",
    parameters: [
      {
        name: "staged",
        type: "boolean",
        description: "Show staged changes instead of unstaged (default: false)",
        required: false,
      },
    ],
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const staged = args.staged === true;
    const cmd = staged ? "git diff --staged" : "git diff";
    const result = await context.sandbox.execute(cmd, { timeoutSec: 15 });

    return {
      toolCallId: "",
      name: "git_diff",
      content: result.stdout || "(no changes)",
      isError: result.exitCode !== 0,
    };
  },
};
