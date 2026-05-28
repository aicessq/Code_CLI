import type { ChatResult, ToolCall, TokenUsage } from "./message.js";
import type { ModelProfile } from "./model_profile.js";

export interface StreamCallbacks {
  onToken?: (token: string) => void;
  onReasoningToken?: (token: string) => void;
  onToolCallStart?: (name: string) => void;
  onToolCallDelta?: (name: string, argsDelta: string) => void;
}

interface ToolCallAccumulator {
  id: string;
  name: string;
  arguments: string;
}

export class StreamParser {
  private content = "";
  private reasoningContent = "";
  private toolCalls: Map<number, ToolCallAccumulator> = new Map();
  private finishReason: ChatResult["finishReason"] = null;
  private usage: TokenUsage | null = null;
  private rawChunks: Record<string, unknown>[] = [];
  private emittedToolNames = new Set<number>();

  constructor(private callbacks?: StreamCallbacks) {}

  accumulate(chunk: Record<string, unknown>): void {
    this.rawChunks.push(chunk);

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

    // Accumulate content with callback
    if (typeof delta.content === "string" && delta.content) {
      this.content += delta.content;
      this.callbacks?.onToken?.(delta.content);
    }

    // Accumulate reasoning_content with callback
    if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
      this.reasoningContent += delta.reasoning_content;
      this.callbacks?.onReasoningToken?.(delta.reasoning_content);
    }

    // Accumulate tool calls
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

  finalize(profile: ModelProfile): ChatResult {
    const toolCalls: ToolCall[] = [];
    const sortedIndices = [...this.toolCalls.keys()].sort((a, b) => a - b);

    for (const index of sortedIndices) {
      const acc = this.toolCalls.get(index)!;
      let args: Record<string, unknown> = {};
      try {
        args = acc.arguments ? JSON.parse(acc.arguments) : {};
      } catch {
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
