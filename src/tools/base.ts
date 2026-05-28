import type { ToolResult } from "../llm/message.js";
import type { Sandbox } from "../sandbox/base.js";

/**
 * 工具参数定义。
 * 描述单个参数的名称、类型、是否必填等元信息，
 * 由 ToolSchemaRenderer 渲染为 LLM 可理解的 JSON Schema。
 */
export interface ToolParameter {
  name: string;
  type: "string" | "integer" | "boolean" | "number";
  description: string;
  required: boolean;
  /** 可选的枚举值列表，限制参数可选值 */
  enum?: string[];
}

/**
 * 工具 schema 定义。
 * 这是工具的元数据，不包含执行逻辑。
 * ToolSchemaRenderer 会将其渲染为 OpenAI function calling 格式。
 */
export interface ToolSchema {
  name: string;
  description: string;
  parameters: ToolParameter[];
}

/**
 * 工具执行上下文。
 * 由 agent loop 在每次工具调用时注入，提供沙箱和工作目录。
 */
export interface ToolContext {
  workingDirectory: string;
  sandbox: Sandbox;
}

/**
 * 工具接口。
 * 每个工具实现此接口，提供 schema（元数据）和 execute（执行逻辑）。
 * 工具通过 context.sandbox 执行实际操作，自身不直接操作文件系统。
 */
export interface Tool {
  schema: ToolSchema;
  execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}
