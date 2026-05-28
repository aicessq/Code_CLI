import type { ModelProfile } from "../llm/model_profile.js";
import type { Tool, ToolParameter } from "./base.js";

export class ToolSchemaRenderer {
  render(tools: Tool[], profile: ModelProfile): Record<string, unknown>[] {
    if (profile.preferredToolSchemaStyle === "flat_json_schema") {
      return tools.map((t) => this.renderFlat(t));
    }
    return tools.map((t) => this.renderStandard(t));
  }

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
