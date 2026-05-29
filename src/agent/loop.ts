/**
 * Agent Loop - 核心智能体循环
 *
 * 这是整个系统的核心编排逻辑。
 * 它实现了 "观察-思考-行动" 循环:
 *   1. 构建消息列表（观察）→ ContextPacker 压缩以适应 token 预算
 *   2. 调用 LLM 获取响应（思考）
 *   3. 执行工具调用（行动）→ ObservationCompressor 压缩工具输出
 *   4. 重复直到任务完成或达到最大步数
 *
 * 关键设计不变量:
 * - runAgent 函数永不检查 profile.name 或 profile.provider
 * - 所有模型特异性行为封装在 profile、llm.chat()、TranscriptSerializer 和 PromptLoader 中
 * - 如果模型不调用工具，发送提示消息要求调用 finish
 *
 * 数据流:
 *   AgentState.messages → ContextPacker.build() → llm.chat() → ChatResult
 *   ChatResult.toolCalls → ToolRegistry.validate() → ToolRegistry.run()
 *   ToolResult → ObservationCompressor.compress() → AgentState.addToolResult()
 *
 * 上下文管理:
 * - ContextPacker: 在每次 LLM 调用前压缩消息列表以适应 token 预算
 * - ObservationCompressor: 在存储工具结果前压缩过长的输出
 * - RepoMap: 注入项目目录树到 system prompt，让模型了解项目结构
 */
import type { LLMClient } from "../llm/base.js";
import type { ModelProfile } from "../llm/model_profile.js";
import type { AgentMessage, ToolResult } from "../llm/message.js";
import type { StreamCallbacks } from "../llm/stream_parser.js";
import { AgentState } from "./state.js";
import { PromptLoader } from "./prompt.js";
import { ToolCallRepairer } from "./tool_call_repair.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { Sandbox } from "../sandbox/base.js";
import type { TrajectoryLogger } from "../logs/trajectory.js";
import { createFinishTool } from "../tools/finish.js";
import { ContextPacker } from "../context/packer.js";
import { ObservationCompressor } from "../context/observation_compressor.js";
import { RepoMap } from "../context/repo_map.js";
import type { MemoryLoader } from "../memory/loader.js";
import { createMemoryTools } from "../tools/memory.js";

export interface AgentCallbacks extends StreamCallbacks {
  onStepStart?: (step: number) => void;
  onToolExecute?: (name: string, args: Record<string, unknown>) => void;
  onToolResult?: (name: string, content: string, isError: boolean) => void;
  onStepEnd?: (step: number) => void;
}

/**
 * Agent 运行时配置（注意与 src/config.ts 的 AgentConfig 区分）
 *
 * 这里包含的是运行时依赖，而不是用户配置。
 * 用户配置（API key、model name 等）在 src/config.ts 中定义。
 */
export interface AgentConfig {
  /** 模型 Profile（决定所有模型特异性行为） */
  profile: ModelProfile;
  /** LLM 客户端（负责 API 调用和响应归一化） */
  llm: LLMClient;
  /** 工具注册表（管理工具的注册、验证、执行） */
  registry: ToolRegistry;
  /** 沙盒实例（执行 bash、文件操作等） */
  sandbox: Sandbox;
  /** 可选的轨迹日志记录器 */
  trajectoryLogger?: TrajectoryLogger;
  /** 最大步数（防止无限循环） */
  maxSteps: number;
  /** 工作目录（工具执行的根目录） */
  workingDirectory: string;
  /** 可选的记忆加载器（跨 session 持久化知识） */
  memoryLoader?: MemoryLoader;
  /** 可选的回调函数（流式输出、工具执行状态） */
  callbacks?: AgentCallbacks;
}

/** Agent 运行的最终结果 */
export interface FinalResult {
  /** 任务完成摘要（由 finish 工具提供，或达到最大步数时的默认消息） */
  summary: string;
  /** 轨迹日志目录路径（可用于后续分析） */
  trajectoryPath?: string;
}

/**
 * Agent 主循环函数
 *
 * 执行流程:
 * 1. 初始化状态和 Prompt
 * 2. 循环调用 LLM 和执行工具
 * 3. 输出最终结果
 *
 * @param task - 任务描述（用户输入）
 * @param config - 运行时配置
 * @returns 最终结果（摘要 + 轨迹路径）
 */
export async function runAgent(task: string, config: AgentConfig): Promise<FinalResult> {
  const { profile, llm, registry, sandbox } = config;
  const promptLoader = new PromptLoader();
  const repairer = new ToolCallRepairer();
  const packer = new ContextPacker();
  const compressor = new ObservationCompressor(profile.maxObservationTokens * 3); // tokens → chars approximation
  const repoMap = new RepoMap();

  // 初始化 Agent 状态（消息历史、工具上下文）
  const state = new AgentState(task, config.workingDirectory, sandbox);

  // Register finish tool — callback sets state.finished so the loop can break
  registry.register(createFinishTool((summary: string) => {
    state.setFinished(summary);
  }));

  // Register memory tools — 让 agent 能跨 session 持久化知识
  if (config.memoryLoader) {
    for (const tool of createMemoryTools(config.memoryLoader)) {
      registry.register(tool);
    }
  }

  // ========== 阶段 1: 加载系统 Prompt ==========
  // PromptLoader 从 src/prompts/*.md 加载模板
  // 模板中的 {task_description} 和 {tool_names} 会被替换
  // 注入 RepoMap 让模型了解项目结构
  // 注入 Memory 让模型了解跨 session 的知识
  const systemPrompt = promptLoader.load(profile.promptProfile);
  let repoTree = "";
  try {
    repoTree = repoMap.generate(config.workingDirectory);
  } catch {
    // 仓库目录树生成失败不影响主流程
  }

  // 构建记忆上下文
  const memoryContext = config.memoryLoader?.buildMemoryContext() ?? "";

  state.addSystemMessage(
    systemPrompt
      .replace("{task_description}", task)
      .replace("{tool_names}", registry.list().map((t) => t.schema.name).join(", "))
      + (repoTree ? `\n\nProject structure:\n\`\`\`\n${repoTree}\n\`\`\`` : "")
      + (memoryContext ? `\n\n${memoryContext}` : "")
  );

  // ========== 阶段 2: 主循环 ==========
  for (let step = 0; step < config.maxSteps; step++) {
    config.callbacks?.onStepStart?.(step);

    // ContextPacker: 压缩消息列表以适应 token 预算
    const messages = packer.build(state, profile);

    const result = await llm.chat(
      messages,
      registry.schemas(profile),
      profile,
      profile.supportsStreaming,
      config.callbacks  // pass stream callbacks
    );

    // 通知回调流式输出结束（UI 层负责渲染换行，agent 层不直接操作 stdout）
    config.callbacks?.onStepEnd?.(step);

    state.addAssistantMessage(result.assistantMessage);
    config.trajectoryLogger?.logAssistantTurn(step, result);

    // ========== 处理工具调用 ==========
    if (result.toolCalls.length > 0) {
      await executeToolCalls(result.toolCalls, step, state, config, profile, llm, registry, repairer, compressor);
      if (state.isFinished()) break;
      continue;
    }

    // ========== 无工具调用（纯文本响应） ==========
    if (state.isFinished()) break;

    // 否则发送提示消息，要求模型调用工具
    // 这是一种"推动"机制，防止模型只输出文本而不行动
    state.addUserMessage(
      "You have not called any tools. If your task is complete, call the `finish` tool with a summary. Otherwise, continue working."
    );
  }

  // ========== 阶段 3: 最终化 ==========
  // 写入最终的 trajectory 日志（metrics.json）
  config.trajectoryLogger?.writeFinal(state);

  return {
    summary: state.summary ?? "Agent reached max steps without finishing.",
    trajectoryPath: config.trajectoryLogger?.outputDir,
  };
}

/**
 * 执行工具调用列表。
 * 提取为独立函数以保持 runAgent 的可读性。
 *
 * 并行执行策略：
 * - 当 profile.supportsParallelToolCalls 为 true 且有多个工具调用时，
 *   使用 Promise.all 并行执行（所有调用先验证再批量执行）
 * - 否则顺序执行（每个调用验证→修复→执行→存储）
 *
 * 注意：并行模式下，finish 工具的检测在所有调用完成后统一处理。
 */
async function executeToolCalls(
  toolCalls: import("../llm/message.js").ToolCall[],
  step: number,
  state: AgentState,
  config: AgentConfig,
  profile: ModelProfile,
  llm: LLMClient,
  registry: ToolRegistry,
  repairer: ToolCallRepairer,
  compressor: ObservationCompressor,
): Promise<void> {
  // 并行模式：多个工具调用且模型支持并行
  if (profile.supportsParallelToolCalls && toolCalls.length > 1) {
    const results = await Promise.all(
      toolCalls.map((call) => executeOneToolCall(call, step, state, config, profile, llm, registry, repairer, compressor))
    );
    // 检查是否有 finish 调用
    for (let i = 0; i < toolCalls.length; i++) {
      if (toolCalls[i].name === "finish" && state.isFinished()) break;
    }
    return;
  }

  // 顺序模式：逐个执行
  for (const call of toolCalls) {
    await executeOneToolCall(call, step, state, config, profile, llm, registry, repairer, compressor);
    if (call.name === "finish" && state.isFinished()) {
      break;
    }
  }
}

/**
 * 执行单个工具调用：验证 → 修复（如失败）→ 执行 → 压缩结果 → 存储。
 */
async function executeOneToolCall(
  call: import("../llm/message.js").ToolCall,
  step: number,
  state: AgentState,
  config: AgentConfig,
  profile: ModelProfile,
  llm: LLMClient,
  registry: ToolRegistry,
  repairer: ToolCallRepairer,
  compressor: ObservationCompressor,
): Promise<ToolResult> {
  const validation = registry.validate(call);

  let toolResult: ToolResult;
  if (!validation.ok) {
    const repaired = await repairer.repair(call, validation.error!, profile, llm);
    if (repaired) {
      config.callbacks?.onToolExecute?.(repaired.name, repaired.arguments);
      toolResult = await registry.run(repaired, state.toolContext);
      toolResult = { ...toolResult, content: compressor.compress(repaired.name, toolResult.content) };
      state.addToolResult(repaired, toolResult);
      config.trajectoryLogger?.logToolCall(step, repaired, toolResult);
      config.callbacks?.onToolResult?.(repaired.name, toolResult.content, toolResult.isError);
    } else {
      toolResult = {
        toolCallId: call.id,
        name: call.name,
        content: `Tool call validation failed: ${validation.error}. Repair also failed.`,
        isError: true,
      };
      state.addToolResult(call, toolResult);
    }
  } else {
    config.callbacks?.onToolExecute?.(call.name, call.arguments);
    toolResult = await registry.run(call, state.toolContext);
    toolResult = { ...toolResult, content: compressor.compress(call.name, toolResult.content) };
    state.addToolResult(call, toolResult);
    config.trajectoryLogger?.logToolCall(step, call, toolResult);
    config.callbacks?.onToolResult?.(call.name, toolResult.content, toolResult.isError);
  }

  return toolResult;
}
