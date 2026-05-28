import type { Tool, ToolContext } from "./base.js";
import type { ToolResult } from "../llm/message.js";

export const applyPatchTool: Tool = {
  schema: {
    name: "apply_patch",
    description: "Apply a unified diff patch to the working directory",
    parameters: [
      {
        name: "patch",
        type: "string",
        description: "Unified diff format patch content",
        required: true,
      },
    ],
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const patch = String(args.patch);

    if (!patch.trim()) {
      return {
        toolCallId: "",
        name: "apply_patch",
        content: "Error: empty patch",
        isError: true,
      };
    }

    // Write patch to a temp file and apply it
    const tempPatchFile = `/tmp/patch_${Date.now()}.diff`;
    const escapedPatch = patch.replace(/'/g, "'\\''");

    const cmd = `cat > '${tempPatchFile}' << 'PATCH_EOF'\n${patch}\nPATCH_EOF\ngit apply --check '${tempPatchFile}' 2>&1 && git apply '${tempPatchFile}' 2>&1 && echo "Patch applied successfully" || echo "Patch application failed"`;
    const result = await context.sandbox.execute(cmd, { timeoutSec: 30 });

    // Cleanup
    await context.sandbox.execute(`rm -f '${tempPatchFile}'`, { timeoutSec: 5 });

    return {
      toolCallId: "",
      name: "apply_patch",
      content: result.stdout || result.stderr,
      isError: result.exitCode !== 0,
    };
  },
};
