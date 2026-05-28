# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`mimocoding` — a model-profile-driven CLI coding agent runtime. The core agent loop is model-agnostic; model-specific behavior (especially MiMo's `reasoning_content` replay) is encapsulated in `ModelProfile`, `LLMClient`, and `TranscriptSerializer`. The agent never checks which model it's using.

## Commands

```bash
npm run build          # tsc -> dist/
npm run dev            # tsx src/index.ts (no build needed)
npm start              # node dist/index.js
npm test               # vitest run
npm run test:watch     # vitest watch mode
npm run lint           # eslint src/
npm run format         # prettier --write src/
npm run eval:probe     # Probe API protocol details
npm run eval:tools     # Tool-call reliability evals
npm run eval:coding    # Coding task evals
```

## Architecture

### Model-Agnostic Core

`runAgent()` in `src/agent/loop.ts` never checks `profile.name` or `profile.provider`. All model-specific behavior flows through:

- **`ModelProfile`** (`src/llm/model_profile.ts`): capability flags only (no endpoint/apiKey). `maxTokensParamName` is derived from `provider` via `getMaxTokensParamName()`.
- **`TranscriptSerializer`** (`src/llm/transcript.ts`): serializes `AgentMessage[]` to wire format, conditionally including `reasoning_content`
- **`ResponseNormalizer`** (`src/llm/response_normalizer.ts`): extracts `reasoning_content` from raw API responses
- **`StreamParser`** (`src/llm/stream_parser.ts`): accumulates `delta.reasoning_content` separately from `delta.content`, fires `StreamCallbacks` on each token

### Callback / Streaming System

Two-layer callback interface hierarchy. A single callbacks object flows from REPL through the entire pipeline:

```
buildCallbacks() in repl.ts
  → runAgent(task, { callbacks })           // AgentCallbacks
    → llm.chat(..., callbacks)              // passed as StreamCallbacks
      → new StreamParser(callbacks)         // fires onToken/onReasoningToken/onToolCallStart
    → config.callbacks?.onToolExecute(...)  // fires agent lifecycle events
```

**`StreamCallbacks`** (`src/llm/stream_parser.ts`): low-level streaming — `onToken`, `onReasoningToken`, `onToolCallStart`, `onToolCallDelta`

**`AgentCallbacks extends StreamCallbacks`** (`src/agent/loop.ts`): adds lifecycle — `onStepStart`, `onToolExecute`, `onToolResult`, `onStepEnd`

**`LLMClient.chat()`** signature: `(messages, tools, profile, stream?, callbacks?) => Promise<ChatResult>`

### reasoning_content Protocol (MiMo/DeepSeek Critical)

MiMo/DeepSeek require `reasoning_content` to be replayed in multi-turn conversations or API returns 400. The pipeline:
1. Inbound: `ResponseNormalizer` extracts `message[profile.reasoningContentField]` → `AssistantMessage.reasoningContent`
2. Storage: `AgentState` preserves full `AssistantMessage` including `reasoningContent`
3. Outbound: `TranscriptSerializer` includes `reasoning_content` only when `profile.requiresReasoningContentReplay === true`
4. Compression: `ContextPacker` NEVER truncates `reasoningContent` — drops older messages instead

### Configuration System

Provider-based config at `~/.mimocoding/settings.json` (Claude Code style). Each provider has its own `apiKey`, `baseURL`, and `model`. The `activeProvider` selects which one to use.

Search order: `~/.mimocoding/settings.json` → `./mimocoding.json` → `./settings.json`

`loadSettings()` returns `Settings`. `resolveConfig(settings)` merges provider credentials with `ModelProfile` capabilities into `ResolvedConfig`.

### Wiring Pattern

```
src/index.ts (CLI entry — commander)
  → loadSettings() → resolveConfig()
  → src/repl.ts
    → executeTask(task, settings)   // one-shot mode
    → startREPL(settings)           // interactive mode
      → buildCallbacks()            // constructs AgentCallbacks with ANSI UI
      → OpenAICompatibleClient(apiKey, baseURL)
      → ToolRegistry (7 tools + finish via createFinishTool callback)
      → LocalSandbox / DockerSandbox
      → TrajectoryLogger
      → runAgent(task, { callbacks, ... })
```

### REPL UI (`src/repl.ts`)

ANSI color helpers in `c` object. `buildCallbacks()` constructs `AgentCallbacks` that render:
- Reasoning tokens: dimmed magenta with "thinking..." prefix
- Content tokens: white, streamed in real-time
- Tool calls: emoji icon + cyan name + dimmed args
- Tool results: green ✓ / red ✗ + truncated preview

`executeTask()` handles one-shot mode; `startREPL()` handles interactive mode with `/help`, `/provider`, `/config`, `/clear`, `/quit` commands.

### Components Built But Not Yet Integrated

- `ContextPacker` and `ObservationCompressor` in `src/context/` — agent loop sends raw `state.messages` without token management
- `RepoMap` generates directory trees but is never called
- `ToolCallRepairer` hardcodes prompt inline instead of loading `src/prompts/mimo_tool_repair.md`

## Conventions

- ESM project (`"type": "module"`): all local imports use `.js` extensions (e.g., `import { x } from "./foo.js"`)
- TypeScript strict mode, ES2022 target, Node16 module resolution
- Prompt templates are `.md` files in `src/prompts/` with `{task_description}` and `{tool_names}` placeholders
- The `finish` tool uses a callback pattern via `createFinishTool(callback)` — registered inside `runAgent()`, not externally
- Tool schema has two rendering modes: `standard_json_schema` (OpenAI/Claude) and `flat_json_schema` (MiMo — parameters in description string)
- Adding a new model: create `src/profiles/<name>.ts` with `ModelProfile` (no endpoint fields), register in `src/profiles/registry.ts`
- Adding a new provider: user adds entry to `providers` in `~/.mimocoding/settings.json`
