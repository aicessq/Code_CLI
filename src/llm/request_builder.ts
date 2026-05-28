import type { ModelProfile } from "./model_profile.js";
import { getMaxTokensParamName } from "./model_profile.js";

/**
 * OpenAI Chat Completions API 的工具 schema 格式。
 * 所有 provider 共用此格式（MiMo 在 schema_renderer 中转换为 flat 格式）。
 */
export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * API 请求体结构。
 * 使用 [key: string]: unknown 允许 provider 特定字段透传。
 */
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

/**
 * API 请求体构建器。
 *
 * 将序列化后的消息、工具列表和 ModelProfile 组装为符合 OpenAI API 规范的请求体。
 * 关键处理：
 * - max_tokens 参数名根据 provider 动态选择（OpenAI 用 max_completion_tokens，其他用 max_tokens）
 * - 工具列表仅在 profile.supportsToolCalls 为 true 时包含
 * - 流式标志仅在 profile.supportsStreaming 为 true 时启用
 */
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
