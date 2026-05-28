import type { ModelProfile } from "./model_profile.js";
import { getMaxTokensParamName } from "./model_profile.js";

export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface RequestBody {
  model: string;
  messages: Record<string, unknown>[];
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  top_p?: number;
  tools?: Record<string, unknown>[];
  stream?: boolean;
  [key: string]: unknown;
}

export class RequestBuilder {
  build(
    serializedMessages: Record<string, unknown>[],
    tools: Record<string, unknown>[] | null,
    profile: ModelProfile,
    options?: { stream?: boolean; model?: string }
  ): RequestBody {
    const body: RequestBody = {
      model: options?.model ?? profile.name,
      messages: serializedMessages,
      [getMaxTokensParamName(profile.provider)]: profile.maxOutputTokens,
      temperature: profile.defaultTemperature,
      top_p: profile.defaultTopP,
    };

    if (tools && tools.length > 0 && profile.supportsToolCalls) {
      body.tools = tools;
    }

    if (options?.stream && profile.supportsStreaming) {
      body.stream = true;
    }

    return body;
  }
}
