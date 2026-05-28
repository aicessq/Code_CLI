/**
 * Agent Loop - 核心智能体循环
 *
 * 这是整个系统的核心编排逻辑。
 * 它实现了 "观察-思考-行动" 循环:
 *   1. 构建消息列表（观察）
 *   2. 调用 LLM 获取响应（思考）
 *   3. 执行工具调用（行动）
 *   4. 重复直到任务完成或达到最大步数
 *
 * 关键设计不变量:
 * - runAgent 函数永不检查 profile.name 或 profile.provider
 * - 所有模型特异性行为封装在 profile、llm.chat()、TranscriptSerializer 和 PromptLoader 中
 * - 工具调用是顺序执行的（一个接一个），不支持并行
 * - 如果模型不调用工具，发送提示消息要求调用 finish
 *
 * 数据流:
 *   AgentState.messages → llm.chat() → ChatResult
 *   ChatResult.toolCalls → ToolRegistry.validate() → ToolRegistry.run()
 *   ToolResult → AgentState.addToolResult() → 下一轮 llm.chat()
 *
 * 注意: ContextPacker 和 ObservationCompressor 已实现但尚未集成到此循环中。
 * 当前直接使用 state.messages，可能导致长任务的上下文溢出。
 */
import type { LLMClient } from "../llm/base.js";
import type { ModelProfile } from "../llm/model_profile.js";
import type { AgentMessage } from "../llm/message.js";
import type { StreamCallbacks } from "../llm/stream_parser.js";
import { AgentState } from "./state.js";
import { PromptLoader } from "./prompt.js";
import { ToolCallRepairer } from "./tool_call_repair.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { Sandbox } from "../sandbox/base.js";
import type { TrajectoryLogger } from "../logs/trajectory.js";
import { createFinishTool } from "../tools/finish.js";

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

  // 初始化 Agent 状态（消息历史、工具上下文）
  const state = new AgentState(task, config.workingDirectory, sandbox);

  // Register finish tool — callback sets state.finished so the loop can break
  registry.register(createFinishTool((summary: string) => {
    state.setFinished(summary);
  }));

  // ========== 阶段 1: 加载系统 Prompt ==========
  // PromptLoader 从 src/prompts/*.md 加载模板
  // 模板中的 {task_description} 和 {tool_names} 会被替换
  const systemPrompt = promptLoader.load(profile.promptProfile);
  state.addSystemMessage(
    systemPrompt
      .replace("{task_description}", task)
      .replace("{tool_names}", registry.list().map((t) => t.schema.name).join(", "))
  );

  // ========== 阶段 2: 主循环 ==========
  for (let step = 0; step < config.maxSteps; step++) {
    config.callbacks?.onStepStart?.(step);
    const messages = [...state.messages];

    const result = await llm.chat(
      messages,
      registry.schemas(profile),
      profile,
      profile.supportsStreaming,
      config.callbacks  // pass stream callbacks
    );

    // Print newline after streaming
    if (profile.supportsStreaming && (config.callbacks?.onToken || config.callbacks?.onReasoningToken)) {
      process.stdout.write("\n");
    }

    state.addAssistantMessage(result.assistantMessage);
    config.trajectoryLogger?.logAssistantTurn(step, result);

    // ========== 处理工具调用 ==========
    if (result.toolCalls.length > 0) {
      for (const call of result.toolCalls) {
        const validation = registry.validate(call);

        if (!validation.ok) {
          const repaired = await repairer.repair(call, validation.error!, profile, llm);
          if (repaired) {
            config.callbacks?.onToolExecute?.(repaired.name, repaired.arguments);
            const toolResult = await registry.run(repaired, state.toolContext);
            state.addToolResult(repaired, toolResult);
            config.trajectoryLogger?.logToolCall(step, repaired, toolResult);
            config.callbacks?.onToolResult?.(repaired.name, toolResult.content, toolResult.isError);
          } else {
            state.addToolResult(call, {
              toolCallId: call.id,
              name: call.name,
              content: `Tool call validation failed: ${validation.error}. Repair also failed.`,
              isError: true,
            });
          }
        } else {
          config.callbacks?.onToolExecute?.(call.name, call.arguments);
          const toolResult = await registry.run(call, state.toolContext);
          state.addToolResult(call, toolResult);
          config.trajectoryLogger?.logToolCall(step, call, toolResult);
          config.callbacks?.onToolResult?.(call.name, toolResult.content, toolResult.isError);

          if (call.name === "finish" && state.isFinished()) {
            break;
          }
        }
      }

      config.callbacks?.onStepEnd?.(step);
      if (state.isFinished()) break;
      continue;
    }

    // ========== 无工具调用（纯文本响应） ==========
    config.callbacks?.onStepEnd?.(step);
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
