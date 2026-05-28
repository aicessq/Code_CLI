import OpenAI from "openai";
import { LLMClient } from "./base.js";
import { RequestBuilder } from "./request_builder.js";
import { TranscriptSerializer } from "./transcript.js";
import { ResponseNormalizer } from "./response_normalizer.js";
import { StreamParser, type StreamCallbacks } from "./stream_parser.js";
import type { AgentMessage, ChatResult } from "./message.js";
import type { ModelProfile } from "./model_profile.js";

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
 * 注意：constructor 同时设置 Authorization 和 api-key header，
 * 因为部分 provider（如 Azure OpenAI）使用 api-key 而非 Bearer token。
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

  /** 同步模式：一次性获取完整响应，通过 ResponseNormalizer 归一化 */
  private async handleSync(body: Record<string, unknown>, profile: ModelProfile): Promise<ChatResult> {
    const response = await this.client.chat.completions.create(
      body as unknown as OpenAI.ChatCompletionCreateParamsNonStreaming
    );
    return this.normalizer.normalize(response as unknown as Record<string, unknown>, profile);
  }

  /** 流式模式：逐 chunk 累积，通过 StreamParser 解析并触发回调 */
  private async handleStream(body: Record<string, unknown>, profile: ModelProfile, callbacks?: StreamCallbacks): Promise<ChatResult> {
    const stream = await this.client.chat.completions.create(
      body as unknown as OpenAI.ChatCompletionCreateParamsStreaming
    );
    const parser = new StreamParser(callbacks);
    for await (const chunk of stream) {
      parser.accumulate(chunk as unknown as Record<string, unknown>);
    }
    return parser.finalize(profile);
  }
}
