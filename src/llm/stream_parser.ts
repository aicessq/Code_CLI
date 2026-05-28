import type { ChatResult, ToolCall, TokenUsage } from "./message.js";
import type { ModelProfile } from "./model_profile.js";

/**
 * 流式回调接口。
 * 由上层（REPL UI）实现，用于实时渲染 token 和工具调用。
 * 所有回调都是可选的，不传则静默丢弃。
 */
export interface StreamCallbacks {
  /** 普通内容 token 回调（模型的文本输出） */
  onToken?: (token: string) => void;
  /** 推理内容 token 回调（MiMo/DeepSeek 的 thinking 过程） */
  onReasoningToken?: (token: string) => void;
  /** 工具调用开始回调（首次出现工具名称时触发，每个工具只触发一次） */
  onToolCallStart?: (name: string) => void;
  /** 工具调用参数增量回调（参数 JSON 字符串分片到达时触发） */
  onToolCallDelta?: (name: string, argsDelta: string) => void;
}

/** 工具调用累积器，用于拼接分片到达的 tool call 数据 */
interface ToolCallAccumulator {
  id: string;
  name: string;
  arguments: string; // JSON 字符串，分片拼接后在 finalize 时解析
}

/**
 * SSE 流式响应解析器。
 *
 * 负责将 OpenAI Chat Completions API 的 SSE chunk 累积为完整的 ChatResult。
 *
 * SSE chunk 格式（OpenAI 规范）：
 * ```
 * { choices: [{ delta: { content: "Hello" } }] }
 * { choices: [{ delta: { reasoning_content: "thinking..." } }] }
 * { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_xxx", function: { name: "bash", arguments: "{}" } }] } }] }
 * { choices: [{ finish_reason: "stop" }], usage: { ... } }
 * ```
 *
 * 关键处理：
 * - content 和 reasoning_content 分别累积（MiMo 的 thinking 和 content 交替到达）
 * - tool_calls 按 index 分组累积（同一个工具的 name 和 arguments 可能在不同 chunk 中）
 * - 工具名称只在首次完整出现时触发 onToolCallStart（避免重复触发）
 * - usage 通常只在最后一个 chunk 中出现
 */
export class StreamParser {
  private content = "";
  private reasoningContent = "";
  private toolCalls: Map<number, ToolCallAccumulator> = new Map();
  private finishReason: ChatResult["finishReason"] = null;
  private usage: TokenUsage | null = null;
  private rawChunks: Record<string, unknown>[] = [];
  /** 已触发过 onToolCallStart 的工具 index 集合，防止重复触发 */
  private emittedToolNames = new Set<number>();

  constructor(private callbacks?: StreamCallbacks) {}

  /**
   * 累积一个 SSE chunk。
   * 每个 chunk 可能包含 usage、content、reasoning_content、tool_calls 中的任意组合。
   */
  accumulate(chunk: Record<string, unknown>): void {
    this.rawChunks.push(chunk);

    // 提取 usage（通常只在最后一个 chunk 中出现）
    if (chunk.usage) {
      const u = chunk.usage as Record<string, unknown>;
      const details = u.completion_tokens_details as Record<string, unknown> | undefined;
      this.usage = {
        promptTokens: (u.prompt_tokens as number) ?? 0,
        completionTokens: (u.completion_tokens as number) ?? 0,
        totalTokens: (u.total_tokens as number) ?? 0,
        reasoningTokens: details?.reasoning_tokens as number | undefined,
      };
    }

    const choices = chunk.choices as Record<string, unknown>[] | undefined;
    if (!choices || choices.length === 0) return;

    const choice = choices[0];
    const delta = choice.delta as Record<string, unknown> | undefined;
    if (!delta) return;

    // 累积普通内容（模型的文本输出）
    if (typeof delta.content === "string" && delta.content) {
      this.content += delta.content;
      this.callbacks?.onToken?.(delta.content);
    }

    // 累积推理内容（MiMo/DeepSeek 的 thinking 过程，与 content 交替到达）
    if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
      this.reasoningContent += delta.reasoning_content;
      this.callbacks?.onReasoningToken?.(delta.reasoning_content);
    }

    // 累积工具调用（按 index 分组，name 和 arguments 可能在不同 chunk 中分片到达）
    const deltaToolCalls = delta.tool_calls as Record<string, unknown>[] | undefined;
    if (deltaToolCalls) {
      for (const dtc of deltaToolCalls) {
        const index = dtc.index as number;
        if (!this.toolCalls.has(index)) {
          this.toolCalls.set(index, {
            id: (dtc.id as string) ?? "",
            name: "",
            arguments: "",
          });
        }

        const acc = this.toolCalls.get(index)!;
        if (dtc.id) acc.id = dtc.id as string;

        const fn = dtc.function as Record<string, unknown> | undefined;
        if (fn) {
          if (fn.name) {
            acc.name += fn.name;
            // 工具名称只在首次完整出现时触发回调
            if (!this.emittedToolNames.has(index)) {
              this.emittedToolNames.add(index);
              this.callbacks?.onToolCallStart?.(fn.name as string);
            }
          }
          if (fn.arguments) {
            acc.arguments += fn.arguments;
            this.callbacks?.onToolCallDelta?.(acc.name, fn.arguments as string);
          }
        }
      }
    }

    if (choice.finish_reason) {
      this.finishReason = choice.finish_reason as ChatResult["finishReason"];
    }
  }

  /**
   * 完成流式解析，生成最终的 ChatResult。
   * - 将累积的 tool_calls 按 index 排序并解析 JSON 参数
   * - 根据 profile 决定是否保留 reasoningContent（MiMo 需要 replay）
   */
  finalize(profile: ModelProfile): ChatResult {
    const toolCalls: ToolCall[] = [];
    const sortedIndices = [...this.toolCalls.keys()].sort((a, b) => a - b);

    for (const index of sortedIndices) {
      const acc = this.toolCalls.get(index)!;
      let args: Record<string, unknown> = {};
      try {
        args = acc.arguments ? JSON.parse(acc.arguments) : {};
      } catch {
        // JSON 解析失败时保留原始字符串，避免工具调用丢失
        args = { _raw: acc.arguments };
      }
      toolCalls.push({ id: acc.id, name: acc.name, arguments: args });
    }

    const assistantMessage = {
      role: "assistant" as const,
      content: this.content || null,
      toolCalls,
      reasoningContent: profile.requiresReasoningContentReplay && this.reasoningContent
        ? this.reasoningContent
        : this.reasoningContent || null,
      raw: { content: this.content, reasoning_content: this.reasoningContent, tool_calls: toolCalls },
    };

    return {
      assistantMessage,
      toolCalls,
      content: assistantMessage.content,
      raw: { chunks: this.rawChunks },
      usage: this.usage,
      finishReason: this.finishReason,
    };
  }
}
