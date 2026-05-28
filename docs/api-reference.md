# API 接口文档

## 1. 核心类型接口

### 1.1 AgentMessage (`src/llm/message.ts`)

所有内部消息的联合类型。Agent Loop 只处理此类型，不直接操作 API wire format。

```typescript
type AgentMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | AssistantMessage
  | ToolResultMessage;
```

### 1.2 AssistantMessage (`src/llm/message.ts`)

模型的完整响应，包含思维链和工具调用。

```typescript
interface AssistantMessage {
  role: "assistant";
  content: string | null;           // 文本内容（工具调用时可能为 null）
  toolCalls: ToolCall[];            // 模型请求的工具调用列表
  reasoningContent: string | null;  // 模型思维链（MiMo/DeepSeek 特有）
  raw: Record<string, unknown>;     // API 原始响应（用于调试和 trajectory 日志）
}
```

**注意**：`raw` 字段绝不能丢弃。MiMo 的 `reasoning_content`、部分 provider 的扩展字段都需要通过原始数据访问。

### 1.3 ToolCall (`src/llm/message.ts`)

模型发出的工具调用请求。

```typescript
interface ToolCall {
  id: string;                       // 唯一标识符，如 "call_abc123"
  name: string;                     // 工具名称，如 "bash"
  arguments: Record<string, unknown>; // 已解析的 JSON 参数对象
}
```

**注意**：`arguments` 已经是解析后的对象，不是 JSON 字符串。`ResponseNormalizer` 负责从 API 响应中的 `function.arguments` JSON 字符串解析。

### 1.4 ToolResult (`src/llm/message.ts`)

工具执行结果，发送回模型。

```typescript
interface ToolResult {
  toolCallId: string;  // 对应 ToolCall.id
  name: string;        // 工具名称
  content: string;     // 观察文本（可能已被 ObservationCompressor 压缩）
  isError: boolean;    // 是否为错误结果
}
```

### 1.5 ChatResult (`src/llm/message.ts`)

LLM 调用的完整结果。

```typescript
interface ChatResult {
  assistantMessage: AssistantMessage;  // 完整的助手消息
  toolCalls: ToolCall[];              // 工具调用列表（快捷访问）
  content: string | null;             // 文本内容（快捷访问）
  raw: Record<string, unknown>;       // API 原始响应
  usage: TokenUsage | null;           // Token 使用统计
  finishReason: "stop" | "tool_calls" | "length" | null;  // 结束原因
}
```

### 1.6 TokenUsage (`src/llm/message.ts`)

```typescript
interface TokenUsage {
  promptTokens: number;      // 输入 token 数
  completionTokens: number;  // 输出 token 数
  totalTokens: number;       // 总 token 数
  reasoningTokens?: number;  // 推理 token 数（MiMo/DeepSeek 单独报告）
}
```

---

## 2. 模型 Profile 接口

### 2.1 ModelProfile (`src/llm/model_profile.ts`)

模型的完整能力描述。这是模型无关性的核心抽象。

```typescript
interface ModelProfile {
  // === 身份标识 ===
  name: string;        // Profile 名称，如 "mimo-v2-pro"
  provider: string;    // 提供商，如 "mimo", "openai", "deepseek"

  // === 容量限制 ===
  contextWindow: number;       // 上下文窗口大小（token 数）
  maxOutputTokens: number;     // 最大输出 token 数

  // === 能力标志 ===
  supportsToolCalls: boolean;          // 是否支持工具调用
  supportsParallelToolCalls: boolean;  // 是否支持并行工具调用（单次返回多个）
  supportsStreaming: boolean;          // 是否支持 SSE 流式响应
  supportsThinking: boolean;           // 是否有思维/推理模式

  // === reasoning_content 协议 ===
  requiresReasoningContentReplay: boolean;  // 是否需要在下一轮回传 reasoning_content
  reasoningContentField: string | null;     // reasoning_content 的字段名

  // === 生成参数默认值 ===
  defaultTemperature: number;  // 温度参数
  defaultTopP: number;         // top_p 参数

  // === 工具 Schema ===
  preferredToolSchemaStyle: "standard_json_schema" | "flat_json_schema";
  maxObservationTokens: number;  // 单个工具观察的 token 预算

  // === Prompt ===
  promptProfile: string;  // 系统 Prompt 模板名（对应 prompts/*.md）

  // === API 配置 ===
  endpoint: string;                                  // API 端点 URL
  maxTokensParamName: "max_tokens" | "max_completion_tokens";  // API 参数名
}
```

### 2.2 ModelProfileRegistry (`src/llm/model_profile.ts`)

Profile 注册表，管理所有可用的模型 Profile。

```typescript
class ModelProfileRegistry {
  register(profile: ModelProfile): void;  // 注册 Profile
  get(name: string): ModelProfile;        // 获取 Profile（不存在则抛异常）
  has(name: string): boolean;             // 检查是否存在
  list(): ModelProfile[];                 // 列出所有 Profile
}
```

---

## 3. LLM 客户端接口

### 3.1 LLMClient (`src/llm/base.ts`)

抽象 LLM 客户端。所有模型交互通过此接口。

```typescript
abstract class LLMClient {
  abstract chat(
    messages: AgentMessage[],           // 内部消息列表
    tools: Record<string, unknown>[] | null,  // 工具 Schema（wire format）
    profile: ModelProfile,              // 模型 Profile
    stream?: boolean                    // 是否使用流式
  ): Promise<ChatResult>;
}
```

### 3.2 OpenAICompatibleClient (`src/llm/openai_compatible.ts`)

唯一的 LLMClient 实现，使用 `openai` npm 包作为 HTTP 传输层。

```typescript
class OpenAICompatibleClient extends LLMClient {
  constructor(apiKey: string, defaultEndpoint?: string);

  async chat(messages, tools, profile, stream?): Promise<ChatResult>;
  // 内部流程:
  // 1. TranscriptSerializer.serialize() → wire format messages
  // 2. RequestBuilder.build() → 完整请求体
  // 3. openai.chat.completions.create() → HTTP 调用
  // 4. ResponseNormalizer.normalize() 或 StreamParser.finalize() → ChatResult
}
```

### 3.3 TranscriptSerializer (`src/llm/transcript.ts`)

将内部 `AgentMessage[]` 序列化为 API wire format。这是模型无关性的关键边界。

```typescript
class TranscriptSerializer {
  serialize(messages: AgentMessage[], profile: ModelProfile): Record<string, unknown>[];
  // - AssistantMessage: 包含 content, tool_calls, 可选 reasoning_content
  // - ToolResultMessage: 转换为 { role: "tool", tool_call_id, content }
  // - reasoning_content 只在 profile.requiresReasoningContentReplay 时包含
}
```

### 3.4 ResponseNormalizer (`src/llm/response_normalizer.ts`)

将 API 原始响应归一化为 `ChatResult`。

```typescript
class ResponseNormalizer {
  normalize(rawResponse: Record<string, unknown>, profile: ModelProfile): ChatResult;
  // - 提取 choices[0].message
  // - 解析 tool_calls（JSON 字符串 → 对象）
  // - 提取 reasoning_content（通过 profile.reasoningContentField）
  // - 提取 usage（包括 reasoning_tokens）
}
```

### 3.5 StreamParser (`src/llm/stream_parser.ts`)

累积 SSE 流式 chunks 为完整的 `ChatResult`。

```typescript
class StreamParser {
  accumulate(chunk: Record<string, unknown>): void;
  // - 累积 delta.content → content
  // - 累积 delta.reasoning_content → reasoningContent（绝不与 content 拼接）
  // - 累积 delta.tool_calls（按 index，arguments 分片拼接）

  finalize(profile: ModelProfile): ChatResult;
  // - 组装累积数据为 ChatResult
}
```

### 3.6 RequestBuilder (`src/llm/request_builder.ts`)

构建 API 请求体。

```typescript
class RequestBuilder {
  build(
    serializedMessages: Record<string, unknown>[],
    tools: Record<string, unknown>[] | null,
    profile: ModelProfile,
    options?: { stream?: boolean; model?: string }
  ): RequestBody;
  // - 使用 profile.maxTokensParamName 决定 max_tokens 还是 max_completion_tokens
  // - 使用 profile.defaultTemperature 和 defaultTopP
}
```

---

## 4. 工具系统接口

### 4.1 Tool (`src/tools/base.ts`)

单个工具的接口定义。

```typescript
interface Tool {
  schema: ToolSchema;  // 工具的 Schema 描述
  execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}

interface ToolSchema {
  name: string;          // 工具名
  description: string;   // 工具描述
  parameters: ToolParameter[];  // 参数列表（扁平结构）
}

interface ToolParameter {
  name: string;
  type: "string" | "integer" | "boolean" | "number";
  description: string;
  required: boolean;
  enum?: string[];
}
```

### 4.2 ToolRegistry (`src/tools/registry.ts`)

工具注册表，管理工具的注册、验证和执行。

```typescript
class ToolRegistry {
  register(tool: Tool): void;
  get(name: string): Tool | undefined;
  list(): Tool[];
  schemas(profile: ModelProfile): Record<string, unknown>[];  // 渲染为 wire format
  validate(call: ToolCall): { ok: boolean; error?: string };   // 验证参数
  run(call: ToolCall, context: ToolContext): Promise<ToolResult>;  // 执行工具
}
```

### 4.3 ToolContext (`src/tools/base.ts`)

工具执行上下文。

```typescript
interface ToolContext {
  workingDirectory: string;  // 工作目录
  sandbox: Sandbox;          // 沙盒实例
}
```

---

## 5. 沙盒接口

### 5.1 Sandbox (`src/sandbox/base.ts`)

沙盒执行环境的抽象接口。

```typescript
interface Sandbox {
  execute(command: string, options?: { timeoutSec?: number }): Promise<SandboxResult>;
  readFile(path: string, startLine?: number, endLine?: number): Promise<string>;
  listFiles(path: string): Promise<string[]>;
  destroy(): Promise<void>;
}

interface SandboxResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;   // 输出是否被截断
  timedOut: boolean;    // 是否超时
}
```

---

## 6. Agent 接口

### 6.1 AgentConfig (`src/agent/loop.ts`)

Agent 运行时配置（注意与 `src/config.ts` 的 `AgentConfig` 不同）。

```typescript
interface AgentConfig {
  profile: ModelProfile;           // 模型 Profile
  llm: LLMClient;                 // LLM 客户端
  registry: ToolRegistry;          // 工具注册表
  sandbox: Sandbox;                // 沙盒实例
  trajectoryLogger?: TrajectoryLogger;  // 可选的轨迹日志
  maxSteps: number;                // 最大步数
  workingDirectory: string;        // 工作目录
}
```

### 6.2 FinalResult (`src/agent/loop.ts`)

Agent 运行的最终结果。

```typescript
interface FinalResult {
  summary: string;          // 任务完成摘要
  trajectoryPath?: string;  // 轨迹日志目录路径
}
```

### 6.3 runAgent (`src/agent/loop.ts`)

Agent 主循环函数。

```typescript
function runAgent(task: string, config: AgentConfig): Promise<FinalResult>;
```

---

## 7. 上下文管理接口

### 7.1 ContextPacker (`src/context/packer.ts`)

消息列表的 token 预算管理。

```typescript
class ContextPacker {
  build(state: AgentState, profile: ModelProfile): AgentMessage[];
  // - 始终保留 system message
  // - 从最新消息向前遍历，直到预算耗尽
  // - 绝不截断 reasoningContent
}
```

### 7.2 ObservationCompressor (`src/context/observation_compressor.ts`)

工具输出的智能压缩。

```typescript
class ObservationCompressor {
  constructor(maxOutputChars?: number);  // 默认 20000
  compress(toolName: string, rawOutput: string): string;
  // - bash: 保留首尾 20 行 + 错误行
  // - grep: 限制 50 条匹配
  // - pytest: 提取 FAILED 测试和 traceback
}
```

### 7.3 TokenCounter (`src/context/token_counter.ts`)

Token 计数器，使用 tiktoken。

```typescript
class TokenCounter {
  count(text: string): number;
  countMessage(msg: AgentMessage): number;  // 含 +4 开销
  countMessages(messages: AgentMessage[]): number;
}
```

---

## 8. 日志接口

### 8.1 TrajectoryLogger (`src/logs/trajectory.ts`)

运行轨迹日志记录器。

```typescript
class TrajectoryLogger {
  readonly outputDir: string;  // 日志输出目录

  logAssistantTurn(step: number, result: ChatResult): void;
  logToolCall(step: number, call: ToolCall, result: ToolResult): void;
  writeFinal(state: AgentState): void;
}
```

输出文件：
- `messages.jsonl` — assistant turn 记录
- `tool_calls.jsonl` — 工具调用记录
- `metrics.json` — 汇总统计

---

## 9. 配置接口

### 9.1 AgentConfig (`src/config.ts`)

用户面向的配置接口（注意与 `src/agent/loop.ts` 的 `AgentConfig` 区分）。

```typescript
interface AgentConfig {
  apiEndpoint: string;      // API 端点
  apiKey: string;           // API 密钥
  model: string;            // 模型 Profile 名

  maxSteps: number;         // 最大步数
  workingDirectory: string; // 工作目录
  sandboxType: "docker" | "local";  // 沙盒类型

  dockerImage: string;      // Docker 镜像
  sandboxTimeoutSec: number; // 沙盒超时
  networkEnabled: boolean;   // 是否启用网络

  logDir: string;           // 日志目录
  trajectoryEnabled: boolean; // 是否启用轨迹日志
}
```

### 9.2 loadConfig (`src/config.ts`)

配置加载函数。

```typescript
function loadConfig(overrides?: Partial<AgentConfig>): AgentConfig;
// 加载顺序: 默认值 → 配置文件 → 环境变量 → overrides 参数
```
