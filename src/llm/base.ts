import type { AgentMessage, ChatResult } from "./message.js";
import type { ModelProfile } from "./model_profile.js";
import type { StreamCallbacks } from "./stream_parser.js";

export abstract class LLMClient {
  abstract chat(
    messages: AgentMessage[],
    tools: Record<string, unknown>[] | null,
    profile: ModelProfile,
    stream?: boolean,
    callbacks?: StreamCallbacks
  ): Promise<ChatResult>;
}
