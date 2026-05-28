/**
 * ToolRegistry - 工具注册表
 *
 * 管理工具的注册、Schema 渲染、验证和执行。
 * 这是工具系统的核心，Agent Loop 通过它与所有工具交互。
 *
 * 核心职责:
 * 1. 注册: register(tool) 将工具加入 Map
 * 2. Schema 渲染: schemas(profile) 委托给 ToolSchemaRenderer
 * 3. 验证: validate(call) 检查工具名、必填参数、enum 值
 * 4. 执行: run(call, context) 执行工具并捕获异常
 *
 * 设计原则:
 * - 工具注册表不知道使用的是哪个模型
 * - Schema 渲染由 profile 驱动（flat vs standard）
 * - 验证失败不会抛异常，而是返回 { ok: false, error }
 * - 执行失败被捕获并返回错误 ToolResult，不会导致 Agent 崩溃
 */
import type { ToolCall, ToolResult } from "../llm/message.js";
import type { ModelProfile } from "../llm/model_profile.js";
import type { Tool, ToolContext } from "./base.js";
import { ToolSchemaRenderer } from "./schema_renderer.js";

export class ToolRegistry {
  private tools = new Map<string, Tool>();
  private renderer = new ToolSchemaRenderer();

  /**
   * 注册一个工具
   * @param tool - 实现 Tool 接口的工具对象
   */
  register(tool: Tool): void {
    this.tools.set(tool.schema.name, tool);
  }

  /**
   * 获取指定名称的工具
   * @returns 工具对象，如果不存在则返回 undefined
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** 列出所有已注册的工具 */
  list(): Tool[] {
    return [...this.tools.values()];
  }

  /**
   * 生成工具 Schema（wire format）
   *
   * 委托给 ToolSchemaRenderer，根据 profile.preferredToolSchemaStyle
   * 选择渲染模式:
   * - "standard_json_schema": OpenAI/Claude 风格
   * - "flat_json_schema": MiMo 风格（参数描述在 description 中）
   */
  schemas(profile: ModelProfile): Record<string, unknown>[] {
    return this.renderer.render(this.list(), profile);
  }

  /**
   * 验证工具调用参数
   *
   * 检查:
   * 1. 工具名是否存在
   * 2. 必填参数是否齐全
   * 3. enum 值是否合法
   *
   * @returns { ok: true } 或 { ok: false, error: "错误描述" }
   */
  validate(call: ToolCall): { ok: boolean; error?: string } {
    // 检查工具是否存在
    const tool = this.tools.get(call.name);
    if (!tool) {
      return { ok: false, error: `Unknown tool: "${call.name}". Available: ${[...this.tools.keys()].join(", ")}` };
    }

    // 检查必填参数
    for (const param of tool.schema.parameters) {
      if (param.required && !(param.name in call.arguments)) {
        return {
          ok: false,
          error: `Missing required parameter "${param.name}" for tool "${call.name}"`,
        };
      }
    }

    // 验证 enum 值
    for (const param of tool.schema.parameters) {
      if (param.enum && param.name in call.arguments) {
        const value = String(call.arguments[param.name]);
        if (!param.enum.includes(value)) {
          return {
            ok: false,
            error: `Invalid value "${value}" for parameter "${param.name}". Must be one of: ${param.enum.join(", ")}`,
          };
        }
      }
    }

    return { ok: true };
  }

  /**
   * 执行工具调用
   *
   * 流程:
   * 1. 查找工具（不存在则返回错误 ToolResult）
   * 2. 调用 tool.execute(args, context)
   * 3. 捕获异常并返回错误 ToolResult
   *
   * 注意: 即使工具执行失败，也不会抛异常。
   * 错误会被捕获并作为 ToolResult 返回给模型，
   * 让模型决定下一步行动（如重试或换一种方法）。
   */
  async run(call: ToolCall, context: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return {
        toolCallId: call.id,
        name: call.name,
        content: `Unknown tool: ${call.name}`,
        isError: true,
      };
    }

    try {
      // 执行工具并返回结果
      // 注意: tool.execute 负责设置 toolCallId 和 name
      // 但这里我们用 call 的值覆盖，确保一致性
      const result = await tool.execute(call.arguments, context);
      return { ...result, toolCallId: call.id, name: call.name };
    } catch (err) {
      // 捕获所有异常，返回错误 ToolResult
      return {
        toolCallId: call.id,
        name: call.name,
        content: `Tool execution error: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  }
}
