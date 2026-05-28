/**
 * ResponseNormalizer - API 响应归一化器
 *
 * 将 OpenAI-compatible API 的原始响应转换为内部 ChatResult。
 * 这是模型无关性的关键组件，负责:
 *
 * 1. 提取 choices[0].message
 * 2. 解析 tool_calls（JSON 字符串 → 对象）
 * 3. 提取 reasoning_content（通过 profile.reasoningContentField）
 * 4. 提取 usage（包括 reasoning_tokens）
 * 5. 保存原始消息到 AssistantMessage.raw
 *
 * 为什么需要归一化?
 * - API 响应格式是 OpenAI 定义的，但内部使用自己的类型系统
 * - tool_calls 的 arguments 是 JSON 字符串，需要解析为对象
 * - reasoning_content 的字段名因模型而异（由 profile 配置）
 * - JSON 解析可能失败，需要优雅降级（包装为 { _raw: ... }）
 *
 * 注意: raw 字段保存完整的原始数据，用于:
 * - 调试和日志
 * - MiMo 的 reasoning_content 原始格式
 * - 部分 provider 的扩展字段
 */
import type { ChatResult, AssistantMessage, ToolCall, TokenUsage } from "./message.js";
import type { ModelProfile } from "./model_profile.js";

export class ResponseNormalizer {
  /**
   * 将 API 原始响应归一化为 ChatResult
   *
   * @param rawResponse - API 返回的原始 JSON 对象
   * @param profile - 模型 Profile（决定 reasoning_content 字段名）
   * @returns 归一化后的 ChatResult
   * @throws 如果响应格式无效（无 choices 或 message）
   */
  normalize(rawResponse: Record<string, unknown>, profile: ModelProfile): ChatResult {
    // 提取 choices 数组
    const choices = rawResponse.choices as Record<string, unknown>[] | undefined;
    if (!choices || choices.length === 0) {
      throw new Error("API response has no choices");
    }

    // 提取第一个 choice 的 message
    const choice = choices[0];
    const message = choice.message as Record<string, unknown> | undefined;
    if (!message) {
      throw new Error("API response choice has no message");
    }

    const finishReason = (choice.finish_reason as string) ?? null;

    // 提取工具调用（从 JSON 字符串解析为对象）
    const toolCalls = this.extractToolCalls(message);

    // 提取 reasoning_content（MiMo/DeepSeek 特有）
    const reasoningContent = this.extractReasoningContent(message, profile);

    // 构建助手消息
    const assistantMessage: AssistantMessage = {
      role: "assistant",
      content: (message.content as string) ?? null,
      toolCalls,
      reasoningContent,
      raw: message,  // 保存原始消息，绝不能丢弃
    };

    // 提取 token 使用统计
    const usage = this.extractUsage(rawResponse);

    return {
      assistantMessage,
      toolCalls,
      content: assistantMessage.content,
      raw: rawResponse,
      usage,
      finishReason: finishReason as ChatResult["finishReason"],
    };
  }

  /**
   * 提取并解析工具调用
   *
   * API 返回的 tool_calls 格式:
   * [
   *   {
   *     id: "call_abc123",
   *     type: "function",
   *     function: {
   *       name: "bash",
   *       arguments: "{\"cmd\": \"ls -la\"}"  // JSON 字符串
   *     }
   *   }
   * ]
   *
   * 转换为内部格式:
   * [
   *   {
   *     id: "call_abc123",
   *     name: "bash",
   *     arguments: { cmd: "ls -la" }  // 已解析的对象
   *   }
   * ]
   *
   * 容错处理:
   * - 如果 arguments 不是有效 JSON，包装为 { _raw: "原始字符串" }
   * - 这样 Agent 不会因为模型输出无效 JSON 而崩溃
   */
  private extractToolCalls(message: Record<string, unknown>): ToolCall[] {
    const rawToolCalls = message.tool_calls as Record<string, unknown>[] | undefined;
    if (!rawToolCalls || !Array.isArray(rawToolCalls)) return [];

    return rawToolCalls.map((tc) => {
      const fn = tc.function as Record<string, unknown>;
      let args: Record<string, unknown> = {};

      try {
        // 尝试解析 JSON 字符串
        args = typeof fn.arguments === "string" ? JSON.parse(fn.arguments) : (fn.arguments as Record<string, unknown>);
      } catch {
        // JSON 解析失败，包装原始字符串
        // 这允许 ToolCallRepairer 尝试修复
        args = { _raw: fn.arguments };
      }

      return {
        id: tc.id as string,
        name: fn.name as string,
        arguments: args,
      };
    });
  }

  /**
   * 提取 reasoning_content
   *
   * 通过 profile.reasoningContentField 动态决定字段名:
   * - MiMo/DeepSeek: "reasoning_content"
   * - 其他模型: null（不提取）
   *
   * 这是模型无关性的体现——我们不检查模型名称，
   * 而是通过 profile 配置来决定行为。
   */
  private extractReasoningContent(message: Record<string, unknown>, profile: ModelProfile): string | null {
    if (!profile.reasoningContentField) return null;
    const value = message[profile.reasoningContentField];
    return typeof value === "string" ? value : null;
  }

  /**
   * 提取 token 使用统计
   *
   * API 返回的 usage 格式:
   * {
   *   prompt_tokens: 100,
   *   completion_tokens: 50,
   *   total_tokens: 150,
   *   completion_tokens_details: {
   *     reasoning_tokens: 30  // MiMo/DeepSeek 特有
   *   }
   * }
   *
   * reasoning_tokens 包含在 completion_tokens 中，但单独报告以便分析。
   */
  private extractUsage(rawResponse: Record<string, unknown>): TokenUsage | null {
    const rawUsage = rawResponse.usage as Record<string, unknown> | undefined;
    if (!rawUsage) return null;

    let reasoningTokens: number | undefined;
    const details = rawUsage.completion_tokens_details as Record<string, unknown> | undefined;
    if (details && typeof details.reasoning_tokens === "number") {
      reasoningTokens = details.reasoning_tokens;
    }

    return {
      promptTokens: (rawUsage.prompt_tokens as number) ?? 0,
      completionTokens: (rawUsage.completion_tokens as number) ?? 0,
      totalTokens: (rawUsage.total_tokens as number) ?? 0,
      reasoningTokens,
    };
  }
}
