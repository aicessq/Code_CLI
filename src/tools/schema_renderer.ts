import type { ModelProfile } from "../llm/model_profile.js";
import type { Tool, ToolParameter } from "./base.js";

/**
 * 工具 schema 渲染器。
 *
 * 将内部 Tool 定义转换为 LLM API 所需的 function calling schema 格式。
 * 支持两种渲染模式：
 *
 * 1. standard_json_schema（OpenAI/Claude 等标准格式）：
 *    - 参数描述放在 JSON Schema 的 description 字段中
 *    - 结构化、机器可解析
 *
 * 2. flat_json_schema（MiMo 等模型的格式）：
 *    - 参数描述嵌入到函数 description 字符串中
 *    - 因为 MiMo 对 JSON Schema 中的 description 字段解析不稳定，
 *      将参数信息放在函数描述中可显著提高工具调用可靠性
 *    - 参数 description 字段省略，仅保留 type 和 required 信息
 */
export class ToolSchemaRenderer {
  render(tools: Tool[], profile: ModelProfile): Record<string, unknown>[] {
    if (profile.preferredToolSchemaStyle === "flat_json_schema") {
      return tools.map((t) => this.renderFlat(t));
    }
    return tools.map((t) => this.renderStandard(t));
  }

  /** 标准 JSON Schema 格式：参数描述在 properties.description 中 */
  private renderStandard(tool: Tool): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const param of tool.schema.parameters) {
      properties[param.name] = {
        type: param.type,
        description: param.description,
        ...(param.enum ? { enum: param.enum } : {}),
      };
      if (param.required) required.push(param.name);
    }

    return {
      type: "function",
      function: {
        name: tool.schema.name,
        description: tool.schema.description,
        parameters: {
          type: "object",
          properties,
          required,
        },
      },
    };
  }

  /**
   * Flat 格式：参数描述嵌入函数 description 字符串。
   * 例如："Run a shell command\n\nParameters:\n  - cmd (string, required) - The shell command"
   */
  private renderFlat(tool: Tool): Record<string, unknown> {
    const paramDescriptions = tool.schema.parameters.map((p) => {
      const req = p.required ? "required" : "optional";
      const enumHint = p.enum ? ` (one of: ${p.enum.join(", ")})` : "";
      return `${p.name} (${p.type}, ${req}) - ${p.description}${enumHint}`;
    });

    const fullDescription = paramDescriptions.length > 0
      ? `${tool.schema.description}\n\nParameters:\n${paramDescriptions.map((d) => `  - ${d}`).join("\n")}`
      : tool.schema.description;

    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const param of tool.schema.parameters) {
      properties[param.name] = {
        type: param.type,
        ...(param.enum ? { enum: param.enum } : {}),
      };
      if (param.required) required.push(param.name);
    }

    return {
      type: "function",
      function: {
        name: tool.schema.name,
        description: fullDescription,
        parameters: {
          type: "object",
          properties,
          required,
        },
      },
    };
  }
}
