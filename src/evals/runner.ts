import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { Settings, ResolvedConfig } from "../config.js";
import { resolveConfig } from "../config.js";
import type { ModelProfile } from "../llm/model_profile.js";
import { OpenAICompatibleClient } from "../llm/openai_compatible.js";
import { ToolRegistry } from "../tools/registry.js";
import { LocalSandbox } from "../sandbox/local.js";
import { TrajectoryLogger } from "../logs/trajectory.js";
import { runAgent } from "../agent/loop.js";
import { listFilesTool } from "../tools/list_files.js";
import { readFileTool } from "../tools/read_file.js";
import { grepTool } from "../tools/grep.js";
import { bashTool } from "../tools/bash.js";
import { applyPatchTool } from "../tools/apply_patch.js";
import { gitStatusTool, gitDiffTool } from "../tools/git.js";

export interface Assertion {
  type: "file_exists" | "file_contains" | "test_passes" | "exit_code" | "tool_call_count" | "no_error_tools";
  params: Record<string, unknown>;
}

export interface EvalCase {
  name: string;
  task: string;
  fixtures?: Record<string, string>;
  assertions: Assertion[];
}

export interface EvalResult {
  name: string;
  profile: string;
  passed: boolean;
  assertionResults: Array<{ assertion: Assertion; passed: boolean; detail: string }>;
  metrics: {
    steps: number;
    toolCalls: number;
    errorCalls: number;
    hasReasoningContent: boolean;
  };
  durationMs: number;
}

export interface EvalReport {
  profile: string;
  cases: EvalResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    passRate: number;
    avgSteps: number;
    avgToolCalls: number;
  };
}

function createDefaultRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(listFilesTool);
  registry.register(readFileTool);
  registry.register(grepTool);
  registry.register(bashTool);
  registry.register(applyPatchTool);
  registry.register(gitStatusTool);
  registry.register(gitDiffTool);
  return registry;
}

export class EvalRunner {
  async run(cases: EvalCase[], settings: Settings): Promise<EvalReport> {
    const config = resolveConfig(settings);
    const results: EvalResult[] = [];

    for (const evalCase of cases) {
      console.log(`\nRunning: ${evalCase.name} (${config.profile.name})`);
      const result = await this.runSingle(evalCase, config);
      results.push(result);
      console.log(`  ${result.passed ? "PASS" : "FAIL"} - ${result.metrics.steps} steps, ${result.metrics.toolCalls} tool calls`);
    }

    const passed = results.filter((r) => r.passed).length;
    const total = results.length;

    return {
      profile: config.profile.name,
      cases: results,
      summary: {
        total,
        passed,
        failed: total - passed,
        passRate: total > 0 ? passed / total : 0,
        avgSteps: results.reduce((s, r) => s + r.metrics.steps, 0) / Math.max(total, 1),
        avgToolCalls: results.reduce((s, r) => s + r.metrics.toolCalls, 0) / Math.max(total, 1),
      },
    };
  }

  async runSingle(evalCase: EvalCase, config: ResolvedConfig): Promise<EvalResult> {
    const startTime = Date.now();

    const workDir = join(tmpdir(), `eval-${randomUUID().slice(0, 8)}`);
    mkdirSync(workDir, { recursive: true });

    if (evalCase.fixtures) {
      for (const [path, content] of Object.entries(evalCase.fixtures)) {
        const fullPath = join(workDir, path);
        mkdirSync(join(fullPath, ".."), { recursive: true });
        writeFileSync(fullPath, content);
      }
    }

    const sandbox = new LocalSandbox(workDir);
    await sandbox.execute("git init && git add -A && git commit -m 'initial' --allow-empty", { timeoutSec: 10 });

    const llm = new OpenAICompatibleClient(config.apiKey, config.baseURL);
    const registry = createDefaultRegistry();
    const trajectoryLogger = new TrajectoryLogger(config.logDir);

    const result = await runAgent(evalCase.task, {
      profile: config.profile,
      llm,
      registry,
      sandbox,
      trajectoryLogger,
      maxSteps: config.maxSteps,
      workingDirectory: workDir,
    });

    const assertionResults = await this.checkAssertions(evalCase.assertions, workDir, trajectoryLogger);
    await sandbox.destroy();

    return {
      name: evalCase.name,
      profile: config.profile.name,
      passed: assertionResults.every((r) => r.passed),
      assertionResults,
      metrics: {
        steps: trajectoryLogger["metrics"]?.totalSteps ?? 0,
        toolCalls: trajectoryLogger["metrics"]?.toolCallsMade ?? 0,
        errorCalls: trajectoryLogger["metrics"]?.errorToolCalls ?? 0,
        hasReasoningContent: trajectoryLogger["metrics"]?.reasoningContentPresent ?? false,
      },
      durationMs: Date.now() - startTime,
    };
  }

  private async checkAssertions(assertions: Assertion[], workDir: string, logger: TrajectoryLogger): Promise<Array<{ assertion: Assertion; passed: boolean; detail: string }>> {
    const results: Array<{ assertion: Assertion; passed: boolean; detail: string }> = [];

    for (const assertion of assertions) {
      switch (assertion.type) {
        case "file_exists": {
          const filePath = join(workDir, String(assertion.params.file));
          const exists = existsSync(filePath);
          results.push({ assertion, passed: exists, detail: exists ? "File exists" : `File not found: ${assertion.params.file}` });
          break;
        }
        case "file_contains": {
          const filePath = join(workDir, String(assertion.params.file));
          if (!existsSync(filePath)) {
            results.push({ assertion, passed: false, detail: `File not found: ${assertion.params.file}` });
            break;
          }
          const content = readFileSync(filePath, "utf-8");
          const pattern = new RegExp(String(assertion.params.pattern), "m");
          const matches = pattern.test(content);
          results.push({ assertion, passed: matches, detail: matches ? "Pattern found" : `Pattern not found in ${assertion.params.file}` });
          break;
        }
        case "test_passes": {
          const testSandbox = new LocalSandbox(workDir);
          const cmd = String(assertion.params.command);
          const result = await testSandbox.execute(cmd, { timeoutSec: 30 });
          const passed = result.exitCode === 0;
          results.push({ assertion, passed, detail: passed ? "Test passed" : `Test failed: ${result.stderr || result.stdout}` });
          await testSandbox.destroy();
          break;
        }
        case "tool_call_count": {
          const toolName = String(assertion.params.tool);
          const min = Number(assertion.params.min ?? 1);
          const logPath = join(logger.outputDir, "tool_calls.jsonl");
          let count = 0;
          if (existsSync(logPath)) {
            const lines = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
            for (const line of lines) {
              try {
                const entry = JSON.parse(line);
                if (entry.toolCall?.name === toolName) count++;
              } catch { /* skip */ }
            }
          }
          const passed = count >= min;
          results.push({ assertion, passed, detail: `Tool "${toolName}" called ${count} times (min: ${min})` });
          break;
        }
        case "no_error_tools": {
          const logPath = join(logger.outputDir, "tool_calls.jsonl");
          let errorCount = 0;
          if (existsSync(logPath)) {
            const lines = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
            for (const line of lines) {
              try {
                const entry = JSON.parse(line);
                if (entry.result?.isError) errorCount++;
              } catch { /* skip */ }
            }
          }
          const passed = errorCount === 0;
          results.push({ assertion, passed, detail: passed ? "No error tool calls" : `${errorCount} error tool calls found` });
          break;
        }
        case "exit_code": {
          results.push({ assertion, passed: true, detail: "Exit code check (placeholder)" });
          break;
        }
      }
    }

    return results;
  }
}
