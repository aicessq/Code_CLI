/**
 * 模型 Profile 系统
 *
 * ModelProfile 是模型无关性的核心抽象。
 * 它定义了模型的完整能力描述，使得 Agent Loop 可以通过查询 profile
 * 来了解模型的特性，而不需要硬编码模型名称。
 *
 * 设计原则:
 *   agent loop 不知道自己在用 MiMo
 *   tool registry 不知道自己在用 MiMo
 *   sandbox 不知道自己在用 MiMo
 *   context packer 不知道自己在用 MiMo
 *   只有 LLM adapter / ModelProfile / PromptProfile 知道 MiMo 特性
 *
 * 使用方式:
 *   if (profile.requiresReasoningContentReplay) → 保留 reasoning_content
 *   而不是:
 *   if (model.startsWith("mimo")) → 保留 reasoning_content
 */

/**
 * 模型能力的完整描述
 *
 * 每个字段都有明确的用途，使得系统可以优雅地处理不同模型的差异。
 */
export interface ModelProfile {
  // === 身份标识 ===

  /** Profile 名称，如 "mimo-v2-pro", "gpt-4o"。用作注册表的 key */
  name: string;
  /** 提供商标识，如 "mimo", "openai", "deepseek", "qwen" */
  provider: string;

  // === 容量限制 ===

  /** 上下文窗口大小（token 数）。ContextPacker 用此计算 token 预算 */
  contextWindow: number;
  /** 最大输出 token 数。RequestBuilder 用此设置 API 参数 */
  maxOutputTokens: number;

  // === 能力标志 ===

  /** 是否支持工具调用。不支持时，schemas 不会包含在请求中 */
  supportsToolCalls: boolean;
  /** 是否支持并行工具调用（单次返回多个 tool_call）。目前只有 OpenAI 和 Claude 支持 */
  supportsParallelToolCalls: boolean;
  /** 是否支持 SSE 流式响应 */
  supportsStreaming: boolean;
  /** 是否有 thinking/reasoning mode（如 MiMo、DeepSeek R1） */
  supportsThinking: boolean;

  // === reasoning_content 协议（MiMo/DeepSeek 关键） ===

  /**
   * 是否需要在下一轮请求中回传 reasoning_content
   *
   * MiMo 和 DeepSeek 的 API 要求:
   * - 每轮助手消息必须包含之前返回的 reasoning_content
   * - 如果丢失，API 会返回 400 错误或推理质量下降
   *
   * TranscriptSerializer 根据此标志决定是否包含 reasoning_content
   */
  requiresReasoningContentReplay: boolean;
  /**
   * reasoning_content 在 API 响应中的字段名
   * MiMo/DeepSeek: "reasoning_content"
   * 其他模型: null
   *
   * ResponseNormalizer 用此字段从原始响应中提取思维链内容
   */
  reasoningContentField: string | null;

  // === 生成参数默认值 ===

  /** 温度参数。MiMo Pro 默认 1.0（较高），Flash 默认 0.3（较低） */
  defaultTemperature: number;
  /** top_p 参数 */
  defaultTopP: number;

  // === 工具 Schema 渲染 ===

  /**
   * 工具 Schema 渲染风格
   *
   * - "standard_json_schema": OpenAI/Claude 风格，参数描述在 properties 中
   * - "flat_json_schema": MiMo 风格，参数描述在 function.description 中
   *
   * MiMo 对深层嵌套 Schema 理解较差，扁平结构可提高准确率约 15-20%
   */
  preferredToolSchemaStyle: "standard_json_schema" | "flat_json_schema";
  /** 单个工具观察的 token 预算。ObservationCompressor 用此压缩过长的输出 */
  maxObservationTokens: number;

  // === Prompt ===

  /**
   * 系统 Prompt 模板名（对应 src/prompts/*.md 文件）
   *
   * PromptLoader 用此加载对应的 .md 模板文件。
   * 模板中使用 {task_description} 和 {tool_names} 占位符。
   *
   * 可选值:
   * - "generic_coding_agent": 通用编码智能体
   * - "mimo_coding_agent": MiMo 专用编码智能体
   * - "mimo_fast_agent": MiMo Flash 快速智能体
   */
  promptProfile: string;

  // === API 配置（从 Settings 的 ProviderConfig 获取，不在此定义） ===

  /**
   * API 请求中的 token 限制参数名（由 provider 推断）
   *
   * - "max_tokens": OpenAI 旧版、DeepSeek、Qwen
   * - "max_completion_tokens": OpenAI 新版、MiMo
   *
   * RequestBuilder 根据此字段决定使用哪个参数名
   */
}

/**
 * 根据 provider 推断 maxTokensParamName
 * MiMo 和 DeepSeek 使用 max_completion_tokens，其他使用 max_tokens
 */
export function getMaxTokensParamName(provider: string): "max_tokens" | "max_completion_tokens" {
  if (provider === "mimo" || provider === "deepseek") return "max_completion_tokens";
  return "max_tokens";
}

/**
 * 模型 Profile 注册表
 *
 * 管理所有可用的模型 Profile。使用 Map 存储，以 profile.name 为 key。
 *
 * 所有 Profile 在 src/profiles/registry.ts 中预注册。
 * 添加新模型只需:
 * 1. 创建 src/profiles/<name>.ts 定义 ModelProfile 常量
 * 2. 在 src/profiles/registry.ts 中调用 registry.register()
 */
export class ModelProfileRegistry {
  private profiles = new Map<string, ModelProfile>();

  /** 注册一个新的 Profile */
  register(profile: ModelProfile): void {
    this.profiles.set(profile.name, profile);
  }

  /**
   * 获取指定名称的 Profile
   * @throws 如果 Profile 不存在，抛出错误并列出所有可用的 Profile
   */
  get(name: string): ModelProfile {
    const profile = this.profiles.get(name);
    if (!profile) {
      const available = [...this.profiles.keys()].join(", ");
      throw new Error(`Model profile "${name}" not found. Available: ${available}`);
    }
    return profile;
  }

  /** 检查指定名称的 Profile 是否存在 */
  has(name: string): boolean {
    return this.profiles.has(name);
  }

  /** 列出所有已注册的 Profile */
  list(): ModelProfile[] {
    return [...this.profiles.values()];
  }
}
