import OpenAI from "openai";
import { LLMClient } from "./base.js";
import { RequestBuilder } from "./request_builder.js";
import { TranscriptSerializer } from "./transcript.js";
import { ResponseNormalizer } from "./response_normalizer.js";
import { StreamParser, type StreamCallbacks } from "./stream_parser.js";
import type { AgentMessage, ChatResult } from "./message.js";
import type { ModelProfile } from "./model_profile.js";

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

  private async handleSync(body: Record<string, unknown>, profile: ModelProfile): Promise<ChatResult> {
    const response = await this.client.chat.completions.create(
      body as unknown as OpenAI.ChatCompletionCreateParamsNonStreaming
    );
    return this.normalizer.normalize(response as unknown as Record<string, unknown>, profile);
  }

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
