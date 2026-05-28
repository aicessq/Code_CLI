# mimocoding

一个 model-profile-driven 的 CLI 编码智能体运行时，对 MiMo 的 thinking/tool-call 协议做了一等优化。

核心设计原则：**Agent Loop 不感知模型**。所有模型特异性行为（`reasoning_content` 回传、工具 Schema 渲染风格、API 参数差异）封装在 `ModelProfile` + `TranscriptSerializer` + `ResponseNormalizer` 中。

## 快速开始

### 安装

```bash
git clone <repo-url>
cd Code_CLI
npm install
npm run build
npm link        # 全局注册 mimocoding 命令
```

### 初始化配置

```bash
mimocoding init
```

这会在 `~/.mimocoding/settings.json` 生成配置模板。编辑它，填入你的 API Key：

```json
{
  "activeProvider": "mimo-token-plan",
  "providers": {
    "mimo-token-plan": {
      "apiKey": "tp-your-key-here",
      "baseURL": "https://token-plan-cn.xiaomimimo.com/v1",
      "model": "mimo-v2-pro"
    }
  },
  "sandbox": "local",
  "maxSteps": 30
}
```

### 使用

```bash
# 交互式模式（类似 Claude Code）
mimocoding

# 一次性模式
mimocoding "fix the bug in src/utils.ts"

# 临时切换 provider
mimocoding "add tests" --provider openai
```

## 交互式 REPL

```
$ mimocoding
MiMo Coding Agent v0.1.0
Provider: mimo-token-plan (mimo-v2-pro)
Sandbox: local | CWD: /your/project

Type your task, or /help for commands.

> read the source code and find the bug in auth.ts
[agent 执行中...]

> /provider mimo
Switched to: mimo (mimo-v2-pro)

> /config
Active provider: mimo
  Model:     mimo-v2-pro
  Base URL:  https://api.xiaomimimo.com/v1
  API Key:   ****2sl7
Sandbox:     local
Max steps:   30

> /quit
```

## 配置系统

### Provider 模式

配置按 provider 区分凭证和 endpoint，每个 provider 独立存储 `apiKey`、`baseURL`、`model`：

```json
{
  "activeProvider": "mimo-token-plan",
  "providers": {
    "mimo-token-plan": {
      "apiKey": "tp-xxx",
      "baseURL": "https://token-plan-cn.xiaomimimo.com/v1",
      "model": "mimo-v2-pro"
    },
    "mimo": {
      "apiKey": "sk-xxx",
      "baseURL": "https://api.xiaomimimo.com/v1",
      "model": "mimo-v2-pro"
    },
    "openai": {
      "apiKey": "sk-xxx",
      "baseURL": "https://api.openai.com/v1",
      "model": "gpt-4o"
    },
    "deepseek": {
      "apiKey": "sk-xxx",
      "baseURL": "https://api.deepseek.com/v1",
      "model": "deepseek-v3"
    }
  }
}
```

### 配置文件搜索顺序

1. `~/.mimocoding/settings.json` （全局首选）
2. `./mimocoding.json` （项目级覆盖）
3. `./settings.json` （项目级）

### 环境变量

| 变量 | 说明 |
|------|------|
| `CODE_AGENT_API_KEY` | API 密钥 |
| `CODE_AGENT_API_ENDPOINT` | API 端点 |
| `CODE_AGENT_MODEL` | 模型名 |
| `CODE_AGENT_SANDBOX_TYPE` | `local` 或 `docker` |

## 内置工具

| 工具 | 功能 |
|------|------|
| `list_files` | 列出目录内容 |
| `read_file` | 读取文件（支持行范围） |
| `grep` | ripgrep 搜索 |
| `bash` | 执行 shell 命令（受安全策略保护） |
| `apply_patch` | 应用 unified diff 补丁 |
| `git_status` | 查看 git 状态 |
| `git_diff` | 查看未提交更改 |
| `finish` | 标记任务完成 |

## 沙盒模式

| 模式 | 说明 |
|------|------|
| `local`（默认） | 本地 `bash -c` 执行，带超时和输出截断 |
| `docker` | Docker 容器隔离，512MB 内存限制，网络默认禁用 |

Docker 模式需先构建镜像：

```bash
docker build -t code-agent-sandbox:latest -f Dockerfile.sandbox .
```

## 支持的模型

通过 `ModelProfile` 描述模型能力，不硬编码 endpoint：

| Profile | Provider | 特性 |
|---------|----------|------|
| `mimo-v2-pro` | mimo | 1M context, thinking, reasoning_content 回传 |
| `mimo-v2-flash` | mimo | 256K context, thinking, 更快更便宜 |
| `mimo-v25-pro` | mimo | 1M context, thinking |
| `gpt-4o` | openai | 128K context, 并行工具调用 |
| `deepseek-v3` | deepseek | 128K context, thinking, reasoning_content 回传 |
| `qwen-max` | qwen | 131K context |
| `claude-sonnet-4` | claude-proxy | 200K context, 并行工具调用 |

添加新模型：创建 `src/profiles/<name>.ts`，在 `src/profiles/registry.ts` 注册。

## 架构概览

```
CLI (index.ts)
  → Settings (config.ts) — provider 凭证 + 全局配置
    → REPL (repl.ts) — 交互式 / 一次性
      → LLMClient (openai_compatible.ts) — HTTP 传输层
      → TranscriptSerializer — 消息序列化（reasoning_content 回传）
      → ResponseNormalizer — 响应归一化
      → ToolRegistry — 工具验证 + 执行
      → Sandbox (local / docker) — 隔离执行环境
      → Agent Loop (agent/loop.ts) — 模型无关的主循环
```

**关键不变量**：`runAgent()` 永不检查 `profile.name` 或 `profile.provider`。

## MiMo reasoning_content 协议

MiMo 和 DeepSeek 要求多轮对话中完整回传 `reasoning_content`，否则 API 返回 400。

```
入站: ResponseNormalizer → AssistantMessage.reasoningContent
出站: TranscriptSerializer → 仅当 profile.requiresReasoningContentReplay 时包含
压缩: ContextPacker 绝不截断 reasoningContent
```

## 开发

```bash
npm run build          # TypeScript 编译
npm run dev            # tsx 直接运行（免编译）
npm test               # 运行测试
npm run eval:probe     # API 协议探测
npm run eval:tools     # 工具调用可靠性评测
npm run eval:coding    # 编码任务评测
```

## 技术栈

- TypeScript (ES2022, strict, ESM)
- Node.js >= 20
- `openai` npm 包作为 HTTP 传输层
- `commander` CLI 框架
- `dockerode` Docker 容器管理
- `js-tiktoken` Token 计数

## 详细文档

- [系统架构设计文档](docs/architecture.md)
- [API 接口文档](docs/api-reference.md)
