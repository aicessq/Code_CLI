/**
 * 核心消息类型系统
 *
 * 定义了 Agent 内部使用的所有消息类型。
 * 这些类型是模型无关的——Agent Loop 只处理这些类型，
 * 不直接操作 API wire format（如 OpenAI 的 chat completion 格式）。
 *
 * 消息流转路径:
 *   API 响应 → ResponseNormalizer → AssistantMessage → AgentState
 *   AgentState → TranscriptSerializer → API wire format → API 请求
 */

/**
 * 模型发出的工具调用请求
 *
 * 当模型决定需要使用工具时，返回一个或多个 ToolCall。
 * 每个 ToolCall 包含一个唯一 ID、工具名称和已解析的参数对象。
 *
 * 注意: arguments 是已解析的 JSON 对象，不是字符串。
 * ResponseNormalizer 负责从 API 响应中的 function.arguments JSON 字符串解析。
 * 如果 JSON 解析失败，会包装为 { _raw: "原始字符串" }。
 */
export interface ToolCall {
  /** 工具调用的唯一标识符，如 "call_abc123"。在多轮对话中必须保持不变。 */
  id: string;
  /** 工具名称，如 "bash", "read_file", "grep"。必须与 ToolRegistry 中注册的名称匹配。 */
  name: string;
  /** 已解析的参数对象。类型取决于具体工具，如 { cmd: "ls -la" } */
  arguments: Record<string, unknown>;
}

/**
 * 工具执行结果，发送回模型
 *
 * 工具执行后产生的观察（observation），会被添加到消息历史中。
 * 模型在下一轮会看到这个结果，并据此决定下一步行动。
 *
 * 注意: content 可能已被 ObservationCompressor 压缩过。
 * 原始输出保存在 trajectory 日志中，压缩后的版本发送给模型。
 */
export interface ToolResult {
  /** 对应 ToolCall.id，用于将结果与请求关联 */
  toolCallId: string;
  /** 工具名称 */
  name: string;
  /** 观察文本（可能已被压缩） */
  content: string;
  /** 是否为错误结果。错误结果会触发 ToolCallRepairer 尝试修复 */
  isError: boolean;
}

/**
 * 助手消息（模型的完整响应）
 *
 * 这是最复杂的消息类型，承载了模型的完整响应信息。
 * 对于 MiMo/DeepSeek 等支持 thinking mode 的模型，
 * reasoningContent 字段包含模型的思维链内容。
 *
 * 关键设计:
 * - raw 字段保存完整的原始 API 响应，绝不能丢弃
 * - reasoningContent 在 ContextPacker 中绝不能被截断
 * - toolCalls 可能为空数组（纯文本响应时）
 */
export interface AssistantMessage {
  role: "assistant";
  /** 文本内容。工具调用时可能为 null（模型只调用工具不输出文本） */
  content: string | null;
  /** 模型请求的工具调用列表。为空数组时表示纯文本响应 */
  toolCalls: ToolCall[];
  /**
   * 模型的思维链内容（MiMo/DeepSeek 特有）
   *
   * 这是 reasoning_content 协议的核心字段:
   * - 入站: ResponseNormalizer 从 API 响应中提取
   * - 存储: AgentState 完整保存
   * - 出站: TranscriptSerializer 在 profile.requiresReasoningContentReplay 时回传
   * - 压缩: ContextPacker 绝不截断此字段
   *
   * 对于不支持 thinking mode 的模型（如 GPT-4o），此字段为 null。
   */
  reasoningContent: string | null;
  /**
   * API 原始响应消息（用于调试和 trajectory 日志）
   *
   * 保存完整的原始数据，因为:
   * 1. MiMo 的 reasoning_content 需要原始格式
   * 2. 部分 provider 有扩展字段
   * 3. 调试时需要查看原始响应
   */
  raw: Record<string, unknown>;
}

/**
 * 工具结果消息（发送给 API 的格式）
 *
 * 注意: 这里的字段名使用 camelCase（内部格式），
 * TranscriptSerializer 会转换为 snake_case（API wire format）:
 *   toolCallId → tool_call_id
 */
export interface ToolResultMessage {
  role: "tool";
  /** 对应 ToolCall.id（API wire format 中为 tool_call_id） */
  toolCallId: string;
  /** 工具输出内容 */
  content: string;
  /** 工具名称（可选，部分 API 需要） */
  name?: string;
}

/**
 * 所有内部消息的联合类型
 *
 * Agent Loop 和 ContextPacker 只处理此类型，
 * 不关心具体是哪种消息。TranscriptSerializer 负责
 * 根据 role 分别序列化为不同的 wire format。
 */
export type AgentMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | AssistantMessage
  | ToolResultMessage;

/**
 * Token 使用统计
 *
 * 从 API 响应的 usage 字段提取。
 * MiMo/DeepSeek 会单独报告 reasoningTokens。
 */
export interface TokenUsage {
  /** 输入 token 数（包含 system prompt + 历史消息 + 工具 Schema） */
  promptTokens: number;
  /** 输出 token 数（包含 reasoning tokens） */
  completionTokens: number;
  /** 总 token 数 */
  totalTokens: number;
  /**
   * 推理 token 数（MiMo/DeepSeek 特有）
   *
   * 从 usage.completion_tokens_details.reasoning_tokens 提取。
   * 这些 token 包含在 completionTokens 中，但单独报告以便分析。
   */
  reasoningTokens?: number;
}

/**
 * LLM 调用的完整结果
 *
 * 包含归一化后的助手消息和原始 API 响应。
 * Agent Loop 通过此对象获取模型的响应并决定下一步行动。
 */
export interface ChatResult {
  /** 归一化后的助手消息（包含 reasoningContent） */
  assistantMessage: AssistantMessage;
  /** 工具调用列表（快捷访问，等同于 assistantMessage.toolCalls） */
  toolCalls: ToolCall[];
  /** 文本内容（快捷访问，等同于 assistantMessage.content） */
  content: string | null;
  /** API 原始响应（用于调试和日志） */
  raw: Record<string, unknown>;
  /** Token 使用统计（部分 API 可能不返回） */
  usage: TokenUsage | null;
  /**
   * 结束原因
   * - "stop": 模型自然结束
   * - "tool_calls": 模型请求工具调用
   * - "length": 达到 max_tokens 限制
   * - null: 流式响应中可能为 null
   */
  finishReason: "stop" | "tool_calls" | "length" | null;
}
