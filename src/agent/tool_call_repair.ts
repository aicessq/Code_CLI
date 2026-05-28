import type { ToolCall } from "../llm/message.js";
import type { LLMClient } from "../llm/base.js";
import type { ModelProfile } from "../llm/model_profile.js";
import type { AgentMessage } from "../llm/message.js";

/**
 * 工具调用修复器。
 *
 * 当模型生成的工具调用验证失败时（参数类型错误、缺少必填参数等），
 * 将无效调用和错误信息发送给 LLM 进行一次性修复尝试。
 *
 * 修复协议：
 * 1. 发送 system prompt 说明修复任务
 * 2. 发送无效工具调用的 JSON 和验证错误信息
 * 3. 要求 LLM 返回修复后的 {"name": "...", "arguments": {...}} 格式
 * 4. 解析 LLM 响应，成功则返回修复后的 ToolCall，失败返回 null
 *
 * 这是一个 best-effort 修复，失败时 agent loop 会跳过该工具调用。
 */
export class ToolCallRepairer {
  async repair(
    invalidCall: ToolCall,
    validationError: string,
    profile: ModelProfile,
    llm: LLMClient
  ): Promise<ToolCall | null> {
    const repairMessages: AgentMessage[] = [
      {
        role: "system",
        content: `You are a tool call repair assistant. Given an invalid tool call and its validation error, produce a corrected tool call. Reply ONLY with a JSON object in this format: {"name": "tool_name", "arguments": {...}}. Do not include any other text.`,
      },
      {
        role: "user",
        content: `Invalid tool call:\n${JSON.stringify(invalidCall, null, 2)}\n\nValidation error: ${validationError}\n\nProduce the corrected tool call JSON.`,
      },
    ];

    try {
      const result = await llm.chat(repairMessages, null, profile, false);

      if (!result.content) return null;

      // 尝试解析 LLM 返回的 JSON 为修复后的工具调用
      const parsed = JSON.parse(result.content.trim());
      if (parsed.name && typeof parsed.name === "string") {
        return {
          id: invalidCall.id, // 保持原始 toolCallId，确保结果能正确关联
          name: parsed.name,
          arguments: parsed.arguments ?? {},
        };
      }
    } catch {
      // 修复失败：LLM 返回了无法解析的响应
    }

    return null;
  }
}
