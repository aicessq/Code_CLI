import OpenAI from "openai";
import { LLMClient } from "./base.js";
import { RequestBuilder } from "./request_builder.js";
import { TranscriptSerializer } from "./transcript.js";
import { ResponseNormalizer } from "./response_normalizer.js";
import { StreamParser, type StreamCallbacks } from "./stream_parser.js";
import type { AgentMessage, ChatResult } from "./message.js";
import type { ModelProfile } from "./model_profile.js";

/** 可重试的 HTTP 状态码（瞬态错误） */
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

/** 判断错误是否可重试 */
function isRetryable(error: unknown): boolean {
  if (error instanceof OpenAI.APIConnectionError) {
    return true;
  }
  if (error instanceof OpenAI.RateLimitError || error instanceof OpenAI.InternalServerError) {
    return true;
  }
  if (error instanceof OpenAI.APIError) {
    return RETRYABLE_STATUS_CODES.has(error.status);
  }
  // 网络错误（ECONNRESET、ETIMEDOUT 等）
  if (error instanceof Error && "code" in error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code && /^E(CONNRESET|TIMEDOUT|CONNREFUSED|AI_AGAIN)$/.test(code)) {
      return true;
    }
  }
  return false;
}

/**
 * 带指数退避的重试包装器。
 * 对瞬态错误（429、5xx、网络错误）进行重试，永久性错误立即抛出。
 *
 * @param fn - 要重试的异步函数
 * @param maxRetries - 最大重试次数（默认 3）
 * @returns fn 的结果
 */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= maxRetries || !isRetryable(error)) {
        throw error;
      }
      // 指数退避 + 随机抖动：1s, 2s, 4s... + 0~500ms 抖动
      const delay = Math.min(1000 * 2 ** attempt, 8000) + Math.random() * 500;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

/**
 * 基于 OpenAI SDK 的通用 LLM 客户端。
 *
 * 使用 openai npm 包作为 HTTP 传输层，但不依赖 OpenAI 特有逻辑。
 * 所有模型特定行为（序列化、请求构建、响应归一化）委托给专用组件。
 * 适用于所有兼容 OpenAI Chat Completions API 的 provider（OpenAI、MiMo、
 * DeepSeek、Qwen、Claude proxy 等）。
 *
 * 职责拆分：
 * - TranscriptSerializer: AgentMessage[] → wire format（处理 reasoning_content replay）
 * - RequestBuilder: wire format + tools + profile → request body
 * - ResponseNormalizer: raw API response → ChatResult（同步模式）
 * - StreamParser: SSE chunks → ChatResult（流式模式）
 *
 * 重试策略：
 * - 瞬态错误（429、500-504、网络错误）自动重试，最多 3 次
 * - 指数退避 + 随机抖动（1s, 2s, 4s + 0~500ms jitter）
 * - 永久性错误（401、403、404 等）立即抛出
 */
export class OpenAICompatibleClient extends LLMClient {
  private requestBuilder = new RequestBuilder();
  private serializer = new TranscriptSerializer();
  private normalizer = new ResponseNormalizer();
  private client: OpenAI;

  constructor(
    private apiKey: string,
    private baseURL: string
  ) {
    super();
    this.client = new OpenAI({
      apiKey,
      baseURL,
      defaultHeaders: { "api-key": apiKey },
    });
  }

  async chat(
    messages: AgentMessage[],
    tools: Record<string, unknown>[] | null,
    profile: ModelProfile,
    stream = false,
    callbacks?: StreamCallbacks
  ): Promise<ChatResult> {
    const serializedMessages = this.serializer.serialize(messages, profile);
    const body = this.requestBuilder.build(serializedMessages, tools, profile, { stream });

    if (stream) return this.handleStream(body, profile, callbacks);
    return this.handleSync(body, profile);
  }

  /** 同步模式：一次性获取完整响应，通过 ResponseNormalizer 归一化。带重试。 */
  private async handleSync(body: Record<string, unknown>, profile: ModelProfile): Promise<ChatResult> {
    const response = await withRetry(() =>
      this.client.chat.completions.create(
        body as unknown as OpenAI.ChatCompletionCreateParamsNonStreaming
      )
    );
    return this.normalizer.normalize(response as unknown as Record<string, unknown>, profile);
  }

  /** 流式模式：逐 chunk 累积，通过 StreamParser 解析并触发回调。带重试。 */
  private async handleStream(body: Record<string, unknown>, profile: ModelProfile, callbacks?: StreamCallbacks): Promise<ChatResult> {
    const stream = await withRetry(() =>
      this.client.chat.completions.create(
        body as unknown as OpenAI.ChatCompletionCreateParamsStreaming
      )
    );
    const parser = new StreamParser(callbacks);
    for await (const chunk of stream) {
      parser.accumulate(chunk as unknown as Record<string, unknown>);
    }
    return parser.finalize(profile);
  }
}
