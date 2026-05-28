import type { ToolResult } from "../llm/message.js";
import type { Sandbox } from "../sandbox/base.js";

export interface ToolParameter {
  name: string;
  type: "string" | "integer" | "boolean" | "number";
  description: string;
  required: boolean;
  enum?: string[];
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: ToolParameter[];
}

export interface ToolContext {
  workingDirectory: string;
  sandbox: Sandbox;
}

export interface Tool {
  schema: ToolSchema;
  execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}
