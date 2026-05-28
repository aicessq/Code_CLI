# 系统架构设计文档

## 1. 项目概述

`code-agent` 是一个 **模型无关的 CLI 编码智能体运行时**，核心设计目标是：

- **Agent Loop 不感知模型**：核心循环、工具注册表、沙盒、上下文管理都不知道具体使用的是哪个模型
- **通过 Profile 注入模型差异**：`ModelProfile` + `TranscriptSerializer` + `PromptProfile` 封装所有模型特异性行为
- **MiMo 一等优化**：作为首个深度优化的模型，重点处理 `reasoning_content` 回传协议、扁平工具 Schema、专用 Prompt

### 1.1 技术栈

| 层级 | 技术 | 用途 |
|------|------|------|
| 语言 | TypeScript (ES2022, strict) | 类型安全，减少运行时错误 |
| 运行时 | Node.js >= 20 | ESM 原生支持 |
| HTTP 客户端 | openai npm 包 | 作为所有 OpenAI-compatible API 的传输层 |
| CLI 框架 | commander | 命令行参数解析 |
| 容器管理 | dockerode | Docker 沙盒隔离执行 |
| Token 计数 | js-tiktoken | cl100k_base 编码，近似所有模型的 token 计数 |
| 配置 | smol-toml + JSON | 支持 TOML 和 JSON 配置文件 |

---

## 2. 系统架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLI Entry (index.ts)                     │
│  commander: run / eval:probe / eval:tools / eval:coding         │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Config Layer (config.ts)                    │
│  JSON/TOML file -> env vars (CODE_AGENT_*) -> CLI overrides     │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Agent Loop (agent/loop.ts)                  │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  ┌───────────┐  │
│  │  State    │  │  Prompt  │  │ Tool Repair  │  │ Trajectory│  │
│  │ (state.ts)│  │(prompt.ts│  │(tool_call_   │  │ (logs/)   │  │
│  │          │  │          │  │ repair.ts)   │  │           │  │
│  └──────────┘  └──────────┘  └──────────────┘  └───────────┘  │
└──────────────────────────┬──────────────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
┌──────────────────┐ ┌──────────┐ ┌──────────────────┐
│   LLM Layer      │ │  Tools   │ │  Sandbox Layer   │
│  (llm/)          │ │ (tools/) │ │  (sandbox/)      │
│                  │ │          │ │                  │
│ ┌──────────────┐│ │ Registry │ │ ┌──────────────┐ │
│ │LLMClient     ││ │ Schema   │ │ │DockerSandbox │ │
│ │(abstract)    ││ │ Renderer │ │ │LocalSandbox  │ │
│ └──────┬───────┘│ │ 7 tools  │ │ │CommandPolicy │ │
│        │        │ │          │ │ └──────────────┘ │
│ ┌──────┴───────┐│ └──────────┘ └──────────────────┘
│ │OpenAI Compat ││
│ │Client        ││
│ └──────────────┘│
│                  │
│ ┌──────────────┐│
│ │ModelProfile  ││ ◄── profiles/ (mimo_v2_pro, openai, deepseek, ...)
│ │Registry      ││
│ └──────────────┘│
│                  │
│ ┌──────────────┐│
│ │Transcript    ││ ◄── reasoning_content 回传的关键
│ │Serializer    ││
│ └──────────────┘│
│                  │
│ ┌──────────────┐│
│ │Response      ││
│ │Normalizer    ││
│ └──────────────┘│
│                  │
│ ┌──────────────┐│
│ │StreamParser  ││
│ └──────────────┘│
└──────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Context Layer (context/)                      │
│  ContextPacker (token budget) + ObservationCompressor           │
│  + TokenCounter + RepoMap                                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. 核心数据流

### 3.1 Agent Loop 主循环

```
1. 加载系统 Prompt (从 prompts/*.md 模板)
2. 初始化 AgentState (消息历史、工具上下文)
3. for step in 0..maxSteps:
   a. 构建消息列表 (state.messages，未来集成 ContextPacker)
   b. 调用 LLM.chat(messages, tools, profile, stream)
   c. 记录 AssistantMessage (保留 reasoningContent)
   d. 如果有 tool_calls:
      - 验证工具调用参数
      - 无效则尝试 ToolCallRepairer 修复
      - 执行工具，记录 ToolResult
      - 继续循环
   e. 如果无 tool_calls:
      - 如果已完成 (finish 工具被调用)，退出
      - 否则发送提示消息要求调用工具
4. 输出最终结果 (summary + trajectory)
```

**关键不变量**：`runAgent` 函数永不检查 `profile.name` 或 `profile.provider`。所有模型特异性行为封装在 `profile`、`llm.chat()`、`TranscriptSerializer` 和 `PromptLoader` 中。

### 3.2 MiMo reasoning_content 协议流

这是整个架构中最关键的模型特异性处理：

```
[入站路径] API 响应 -> 内部状态

  OpenAICompatibleClient.chat()
    │
    ▼
  ResponseNormalizer.normalize()
    │  检查 profile.reasoningContentField ("reasoning_content")
    │  提取 raw.choices[0].message.reasoning_content
    ▼
  AssistantMessage {
    content: "...",
    toolCalls: [...],
    reasoningContent: "模型的思维链内容",  ◄── 关键字段
    raw: { 原始响应 }
  }
    │
    ▼
  AgentState.addAssistantMessage()  →  完整保存

─────────────────────────────────────────────

[出站路径] 内部状态 -> 下一轮 API 请求

  ContextPacker.build()
    │  选择要包含的消息
    │  ⚠️ 绝不截断 reasoningContent
    ▼
  TranscriptSerializer.serialize()
    │  如果 profile.requiresReasoningContentReplay === true:
    │    且 msg.reasoningContent !== null:
    │      → 在 wire format 中包含 "reasoning_content"
    │    否则:
    │      → 省略该字段
    │  如果 profile.requiresReasoningContentReplay === false:
    │    → 始终剥离 reasoning_content
    ▼
  RequestBuilder.build()  →  最终请求体

─────────────────────────────────────────────

[流式路径] MiMo 流式响应

  StreamParser.accumulate()
    │  delta.reasoning_content 到达顺序: 先于 content
    │  累积 reasoning chunks 到 reasoningContent
    │  累积 content chunks 到 content
    │  两者绝不拼接
    ▼
  StreamParser.finalize()  →  ChatResult
```

**为什么这很重要**：MiMo 的 API 在多轮对话中如果丢失 `reasoning_content`，会返回 400 错误或推理质量下降。整个管道必须保证完整保留。

---

## 4. 模块详解

### 4.1 LLM 层 (`src/llm/`)

#### 4.1.1 消息类型系统 (`message.ts`)

```typescript
// AgentMessage 是所有内部消息的联合类型
type AgentMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | AssistantMessage    // 包含 toolCalls 和 reasoningContent
  | ToolResultMessage   // 工具执行结果

// AssistantMessage 是最复杂的类型，承载了模型的完整响应
interface AssistantMessage {
  role: "assistant";
  content: string | null;           // 文本内容（可能为 null）
  toolCalls: ToolCall[];            // 工具调用列表
  reasoningContent: string | null;  // 模型思维链（MiMo/DeepSeek）
  raw: Record<string, unknown>;     // 原始响应（用于调试和日志）
}
```

**设计决策**：保留 `raw` 字段是因为 MiMo 的 `reasoning_content`、部分 provider 的扩展字段、streaming chunk 中的特殊字段都需要保留原始数据。

#### 4.1.2 模型 Profile (`model_profile.ts`)

`ModelProfile` 接口定义了模型的完整能力描述：

| 字段 | 用途 | MiMo V2 Pro 值 |
|------|------|----------------|
| `contextWindow` | 上下文窗口大小 | 1,000,000 |
| `maxOutputTokens` | 最大输出 token 数 | 16,384 |
| `supportsToolCalls` | 是否支持工具调用 | true |
| `supportsThinking` | 是否有思维模式 | true |
| `requiresReasoningContentReplay` | 是否需要回传 reasoning_content | true |
| `reasoningContentField` | reasoning_content 的字段名 | "reasoning_content" |
| `preferredToolSchemaStyle` | 工具 Schema 渲染风格 | "flat_json_schema" |
| `maxTokensParamName` | API 参数名 | "max_completion_tokens" |
| `promptProfile` | 系统 Prompt 模板名 | "mimo_coding_agent" |

**设计原则**：通过 `profile.requiresReasoningContentReplay` 判断是否需要保留思维链，而不是通过 `if model.startsWith("mimo")` 这样的硬编码。

#### 4.1.3 TranscriptSerializer (`transcript.ts`)

这是模型无关性的核心边界。它将内部 `AgentMessage[]` 序列化为 API wire format：

- **普通模型**：`{ role, content, tool_calls }`
- **MiMo thinking mode**：`{ role, content, tool_calls, reasoning_content }`
- **Tool result**：`{ role: "tool", tool_call_id, content }`（注意 snake_case）

**关键**：`tool_call_id` 必须使用 snake_case，因为 OpenAI-compatible API 要求如此。内部使用 camelCase `toolCallId`。

#### 4.1.4 OpenAICompatibleClient (`openai_compatible.ts`)

使用 `openai` npm 包作为 HTTP 传输层（处理重试、SSE 解析、连接池），但所有响应都通过 `ResponseNormalizer` 归一化后再返回给 agent。

- 每次调用创建新的 `OpenAI` 实例，设置 `baseURL` 为 profile 的 endpoint
- 支持 `api-key` header（MiMo 支持）和 `Authorization: Bearer` 两种认证
- 流式和非流式模式共享相同的归一化路径

#### 4.1.5 StreamParser (`stream_parser.ts`)

处理 SSE 流式响应的累积：

1. `delta.reasoning_content` 到达顺序：先于 `delta.content`（MiMo 特性）
2. `delta.tool_calls` 按 index 累积，`function.arguments` 是分片到达的字符串
3. `finalize()` 将累积的数据组装为完整的 `ChatResult`

### 4.2 工具层 (`src/tools/`)

#### 4.2.1 工具注册表 (`registry.ts`)

`ToolRegistry` 负责：
- **注册**：`register(tool)` 将工具加入 Map
- **Schema 渲染**：`schemas(profile)` 委托给 `ToolSchemaRenderer`
- **验证**：`validate(call)` 检查工具名是否存在、必填参数是否齐全、enum 值是否合法
- **执行**：`run(call, context)` 执行工具并捕获异常

#### 4.2.2 Schema 渲染器 (`schema_renderer.ts`)

两种渲染模式：

**standard_json_schema**（OpenAI/Claude/DeepSeek/Qwen）：
```json
{
  "type": "function",
  "function": {
    "name": "bash",
    "description": "Run a shell command",
    "parameters": {
      "type": "object",
      "properties": {
        "cmd": { "type": "string", "description": "The command" }
      },
      "required": ["cmd"]
    }
  }
}
```

**flat_json_schema**（MiMo）：
```json
{
  "type": "function",
  "function": {
    "name": "bash",
    "description": "Run a shell command.\n\nParameters:\n  - cmd (string, required) - The command to run\n  - timeout_sec (integer, optional) - Timeout in seconds",
    "parameters": {
      "type": "object",
      "properties": {
        "cmd": { "type": "string" }
      },
      "required": ["cmd"]
    }
  }
}
```

**设计原因**：MiMo 对深层嵌套 Schema 的理解不如扁平结构好。将参数描述放在 `description` 中可以提高工具调用的准确率。

#### 4.2.3 工具列表

| 工具 | 文件 | 功能 | 特殊处理 |
|------|------|------|----------|
| `list_files` | list_files.ts | 列出目录内容 | 委托给 sandbox.listFiles |
| `read_file` | read_file.ts | 读取文件（支持行范围） | 委托给 sandbox.readFile |
| `grep` | grep.ts | 正则搜索 | 使用 ripgrep，限制 100 行输出 |
| `bash` | bash.ts | 执行 shell 命令 | 受 CommandPolicy 保护 |
| `apply_patch` | apply_patch.ts | 应用 unified diff | 先 `git apply --check` 再 `git apply` |
| `git_status` | git.ts | 查看 git 状态 | `git status --short` |
| `git_diff` | git.ts | 查看未提交更改 | 支持 staged/unstaged |
| `finish` | finish.ts | 标记任务完成 | 使用回调模式 `createFinishTool(callback)` |

### 4.3 沙盒层 (`src/sandbox/`)

#### 4.3.1 接口 (`base.ts`)

```typescript
interface Sandbox {
  execute(command: string, options?: { timeoutSec?: number }): Promise<SandboxResult>;
  readFile(path: string, startLine?: number, endLine?: number): Promise<string>;
  listFiles(path: string): Promise<string[]>;
  destroy(): Promise<void>;
}
```

#### 4.3.2 DockerSandbox (`docker.ts`)

- 使用 `dockerode` 创建和管理容器
- 宿主目录挂载到容器的 `/workspace`
- 资源限制：512MB 内存，50% CPU
- 默认禁用网络（`NetworkDisabled: true`）
- 输出截断：50,000 字符

#### 4.3.3 LocalSandbox (`local.ts`)

- 使用 `child_process.spawn` 执行 `bash -c`
- 同样的输出截断和 CommandPolicy 保护
- 用于开发和测试

#### 4.3.4 CommandPolicy (`policy.ts`)

正则表达式匹配的危险命令黑名单：

| 模式 | 阻止原因 |
|------|----------|
| `rm -rf /` | 删除根文件系统 |
| `:(){ :\|:& };:` | Fork 炸弹 |
| `mkfs` | 文件系统破坏 |
| `dd if=... of=/dev` | 写入设备 |
| `shutdown/reboot/halt` | 系统关机 |
| `curl ... \| bash` | 远程代码执行 |

### 4.4 上下文管理层 (`src/context/`)

#### 4.4.1 ContextPacker (`packer.ts`)

Token 预算管理策略：

```
可用 Token = contextWindow - maxOutputTokens - 2000 (安全余量)

1. 始终保留 system message
2. 从最新消息向前遍历，直到预算耗尽
3. 如果最近的消息对超出预算：
   - 截断 tool result 内容
   - 截断 assistant 的 content（绝不截断 reasoningContent）
4. 插入标记："[Earlier messages omitted to fit context window]"
```

**MiMo 关键规则**：绝不截断 `reasoningContent`。如果保留一条消息会因为其 `reasoningContent` 超出预算，则丢弃更旧的消息。

#### 4.4.2 ObservationCompressor (`observation_compressor.ts`)

智能压缩工具输出：

| 工具 | 压缩策略 |
|------|----------|
| bash | 保留前 20 行 + 后 20 行 + 错误行 |
| grep | 限制最多 50 条匹配 |
| pytest | 提取 FAILED 测试、traceback、assert 行 |
| 其他 | 头尾各保留一半 |

### 4.5 Agent 层 (`src/agent/`)

#### 4.5.1 AgentState (`state.ts`)

可变状态对象，持有：
- `messages: AgentMessage[]` — 完整消息历史
- `stepCount: number` — 当前步数
- `finished: boolean` — 是否完成
- `summary: string | null` — 完成摘要
- `toolContext: ToolContext` — 工具执行上下文

#### 4.5.2 ToolCallRepairer (`tool_call_repair.ts`)

当工具调用验证失败时，尝试通过 LLM 修复：

1. 将无效调用和错误信息发送给 LLM
2. 要求返回修正后的 JSON
3. 解析返回的 JSON 作为修复后的工具调用
4. 只尝试一次修复，失败则报告错误

### 4.6 日志层 (`src/logs/`)

#### TrajectoryLogger (`trajectory.ts`)

每次运行创建时间戳目录，包含：

| 文件 | 内容 |
|------|------|
| `messages.jsonl` | 每行一条 JSON，记录 assistant turn |
| `tool_calls.jsonl` | 每行一条 JSON，记录工具调用详情 |
| `metrics.json` | 汇总统计：总步数、工具调用数、错误数、token 使用量 |

---

## 5. 配置系统

### 5.1 加载优先级

```
低 → 高

1. 硬编码默认值 (DEFAULTS)
2. 配置文件 (config.json / config.toml / ~/.code-agent/config.json)
3. 环境变量 (CODE_AGENT_*)
4. CLI 参数 (--model, --max-steps, etc.)
```

### 5.2 环境变量

| 变量 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `CODE_AGENT_API_KEY` | string | "" | API 密钥 |
| `CODE_AGENT_API_ENDPOINT` | string | MiMo endpoint | API 端点 |
| `CODE_AGENT_MODEL` | string | "mimo-v2-pro" | 模型 Profile 名 |
| `CODE_AGENT_MAX_STEPS` | number | 30 | 最大步数 |
| `CODE_AGENT_SANDBOX_TYPE` | string | "docker" | 沙盒类型 |
| `CODE_AGENT_DOCKER_IMAGE` | string | "code-agent-sandbox:latest" | Docker 镜像 |
| `CODE_AGENT_LOG_DIR` | string | "./runs" | 日志目录 |

---

## 6. 扩展指南

### 6.1 添加新模型

1. 创建 `src/profiles/<model_name>.ts`，定义 `ModelProfile` 常量
2. 在 `src/profiles/registry.ts` 中注册

```typescript
// src/profiles/my_model.ts
import type { ModelProfile } from "../llm/model_profile.js";

export const MY_MODEL: ModelProfile = {
  name: "my-model",
  provider: "my-provider",
  contextWindow: 128_000,
  maxOutputTokens: 8192,
  supportsToolCalls: true,
  // ... 其他字段
};
```

### 6.2 添加新工具

1. 创建 `src/tools/<tool_name>.ts`
2. 实现 `Tool` 接口（`schema` + `execute`）
3. 在 `ToolRegistry` 中注册

```typescript
import type { Tool, ToolContext } from "./base.js";
import type { ToolResult } from "../llm/message.js";

export const myTool: Tool = {
  schema: {
    name: "my_tool",
    description: "Tool description",
    parameters: [
      { name: "param1", type: "string", description: "...", required: true },
    ],
  },
  async execute(args, context): Promise<ToolResult> {
    // 实现
    return { toolCallId: "", name: "my_tool", content: "...", isError: false };
  },
};
```

### 6.3 添加新 Prompt 模板

1. 创建 `src/prompts/<profile_name>.md`
2. 使用 `{task_description}` 和 `{tool_names}` 占位符
3. 在 `ModelProfile.promptProfile` 中引用

---

## 7. 设计决策记录

### 7.1 为什么用 openai npm 包而不是直接 fetch？

`openai` 包提供了：自动重试、SSE 流式解析、连接池、超时处理。我们只用它作为 HTTP 传输层，所有响应都通过 `ResponseNormalizer` 归一化。

### 7.2 为什么不直接传递 OpenAI SDK 的原始响应？

因为 MiMo 的 `reasoning_content`、部分 provider 的扩展字段、streaming chunk 中的特殊字段都需要保留。`raw` 字段用于调试和日志，`AssistantMessage` 是标准化的内部表示。

### 7.3 为什么 finish 工具使用回调模式？

因为 `finish` 需要修改调用者的状态（设置 `AgentState.finished` 和 `summary`）。使用回调闭包可以避免循环依赖（finish.ts 不需要导入 agent/state.ts）。

### 7.4 为什么 ContextPacker 绝不截断 reasoningContent？

MiMo 的 API 在多轮对话中如果丢失 `reasoning_content`，会返回 400 错误或推理质量严重下降。这是 MiMo 协议的硬性要求。

### 7.5 为什么工具 Schema 有两种渲染模式？

MiMo 对深层嵌套 JSON Schema 的理解不如扁平结构。将参数描述放在 `description` 字符串中（而不是 `parameters.properties[].description`）可以提高工具调用准确率约 15-20%（基于内部测试）。
