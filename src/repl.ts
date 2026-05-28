import * as readline from "node:readline";
import type { Settings, ResolvedConfig } from "./config.js";
import { resolveConfig, CONFIG_DIR } from "./config.js";
import { OpenAICompatibleClient } from "./llm/openai_compatible.js";
import { ToolRegistry } from "./tools/registry.js";
import { LocalSandbox } from "./sandbox/local.js";
import { DockerSandbox } from "./sandbox/docker.js";
import { TrajectoryLogger } from "./logs/trajectory.js";
import { runAgent, type AgentCallbacks } from "./agent/loop.js";
import { listFilesTool } from "./tools/list_files.js";
import { readFileTool } from "./tools/read_file.js";
import { grepTool } from "./tools/grep.js";
import { bashTool } from "./tools/bash.js";
import { applyPatchTool } from "./tools/apply_patch.js";
import { gitStatusTool, gitDiffTool } from "./tools/git.js";
import type { Sandbox } from "./sandbox/base.js";

// ── ANSI helpers ──────────────────────────────────────────────

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
  bgBlue: "\x1b[44m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgRed: "\x1b[41m",
};

function badge(label: string, bg: string, fg = c.white): string {
  return `${bg}${fg}${c.bold} ${label} ${c.reset}`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "...";
}

// ── Tool icon mapping ─────────────────────────────────────────

const TOOL_ICONS: Record<string, string> = {
  list_files: "\u{1F4C1}",  // folder
  read_file: "\u{1F4C4}",   // page
  grep: "\u{1F50D}",        // magnifier
  bash: "\u{1F4BB}",        // computer
  apply_patch: "\u{1F4DD}", // memo
  git_status: "\u{1F500}",  // shuffle
  git_diff: "\u{1F4CA}",    // chart
  finish: "\u{2705}",       // check
};

function toolIcon(name: string): string {
  return TOOL_ICONS[name] ?? "\u{1F527}"; // wrench
}

// ── Registry ──────────────────────────────────────────────────

function createRegistry(): ToolRegistry {
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

// ── Banner ────────────────────────────────────────────────────

function printBanner(settings: Settings) {
  const provider = settings.providers[settings.activeProvider];
  const model = provider?.model ?? "unknown";
  const w = 56;

  console.log();
  console.log(`${c.cyan}${c.bold}${" ".repeat((w - 20) / 2)}MiMo Coding Agent v0.1.0${c.reset}`);
  console.log(`${c.dim}${"─".repeat(w)}${c.reset}`);
  console.log(`  ${c.bold}Provider${c.reset}  ${c.cyan}${settings.activeProvider}${c.reset} ${c.dim}(${model})${c.reset}`);
  console.log(`  ${c.bold}Sandbox${c.reset}   ${settings.sandbox}`);
  console.log(`  ${c.bold}CWD${c.reset}       ${c.dim}${process.cwd()}${c.reset}`);
  console.log(`${c.dim}${"─".repeat(w)}${c.reset}`);
  console.log(`  ${c.dim}Type your task, or ${c.white}/help${c.dim} for commands.${c.reset}`);
  console.log();
}

// ── Help ──────────────────────────────────────────────────────

function showHelp() {
  console.log(`
  ${c.bold}Commands${c.reset}
    ${c.cyan}/help${c.reset}            Show this help
    ${c.cyan}/provider${c.reset} <name> Switch active provider
    ${c.cyan}/config${c.reset}          Show current configuration
    ${c.cyan}/clear${c.reset}           Clear screen
    ${c.cyan}/quit${c.reset}            Exit
`);
}

// ── Config display ────────────────────────────────────────────

function showConfig(settings: Settings) {
  const provider = settings.providers[settings.activeProvider];
  const w = 48;
  console.log(`\n${c.dim}${"─".repeat(w)}${c.reset}`);
  console.log(`  ${c.bold}Active provider${c.reset}  ${c.cyan}${settings.activeProvider}${c.reset}`);
  console.log(`  ${c.bold}Model${c.reset}            ${provider?.model ?? "not set"}`);
  console.log(`  ${c.bold}Base URL${c.reset}         ${c.dim}${provider?.baseURL ?? "not set"}${c.reset}`);
  console.log(`  ${c.bold}API Key${c.reset}          ${provider?.apiKey ? "****" + provider.apiKey.slice(-4) : c.red + "NOT SET" + c.reset}`);
  console.log(`  ${c.bold}Sandbox${c.reset}          ${settings.sandbox}`);
  console.log(`  ${c.bold}Max steps${c.reset}        ${settings.maxSteps}`);
  console.log(`  ${c.bold}Config dir${c.reset}       ${c.dim}${CONFIG_DIR}${c.reset}`);
  console.log(`${c.dim}${"─".repeat(w)}${c.reset}\n`);
}

// ── Build callbacks for streaming + tool display ──────────────

function buildCallbacks(): AgentCallbacks {
  let inReasoning = false;

  return {
    // Reasoning tokens (thinking mode) — dimmed
    onReasoningToken(token: string) {
      if (!inReasoning) {
        inReasoning = true;
        process.stdout.write(`\n${c.dim}${c.magenta}  thinking...${c.reset}\n${c.dim}`);
      }
      process.stdout.write(token);
    },

    // Content tokens — white, normal
    onToken(token: string) {
      if (inReasoning) {
        inReasoning = false;
        process.stdout.write(`${c.reset}\n`);
      }
      process.stdout.write(`${c.white}${token}${c.reset}`);
    },

    // Tool call starting
    onToolCallStart(name: string) {
      if (inReasoning) {
        inReasoning = false;
        process.stdout.write(`${c.reset}\n`);
      }
      process.stdout.write(`\n`);
    },

    // Before tool execution
    onToolExecute(name: string, args: Record<string, unknown>) {
      const icon = toolIcon(name);
      const argStr = Object.entries(args)
        .filter(([k]) => !k.startsWith("_"))
        .map(([k, v]) => `${k}=${truncate(String(v), 40)}`)
        .join(", ");
      console.log(`  ${c.dim}${icon} ${c.cyan}${name}${c.reset}${c.dim}(${argStr})${c.reset}`);
    },

    // After tool execution
    onToolResult(name: string, content: string, isError: boolean) {
      const icon = isError ? `${c.red}✗${c.reset}` : `${c.green}✓${c.reset}`;
      const preview = truncate(content.replace(/\n/g, " "), 80);
      console.log(`  ${icon} ${c.dim}${preview}${c.reset}\n`);
    },
  };
}

// ── Execute task ──────────────────────────────────────────────

export async function executeTask(task: string, settings: Settings): Promise<void> {
  let config: ResolvedConfig;
  try {
    config = resolveConfig(settings);
  } catch (err) {
    console.error(`\n  ${c.red}${c.bold}Error${c.reset} ${err instanceof Error ? err.message : String(err)}\n`);
    return;
  }

  const llm = new OpenAICompatibleClient(config.apiKey, config.baseURL);
  const trajectoryLogger = new TrajectoryLogger(config.logDir);
  const registry = createRegistry();
  const callbacks = buildCallbacks();

  let sandbox: Sandbox;
  if (config.sandbox === "docker") {
    sandbox = await DockerSandbox.create({
      image: config.dockerImage,
      hostDir: config.workingDirectory,
      networkDisabled: true,
    });
  } else {
    sandbox = new LocalSandbox(config.workingDirectory);
  }

  console.log(`\n  ${badge("TASK", c.bgBlue)} ${c.bold}${task}${c.reset}\n`);
  console.log(`${c.dim}${"─".repeat(56)}${c.reset}`);

  const startTime = Date.now();

  try {
    const result = await runAgent(task, {
      profile: config.profile,
      llm,
      registry,
      sandbox,
      trajectoryLogger,
      maxSteps: config.maxSteps,
      workingDirectory: config.workingDirectory,
      callbacks,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n${c.dim}${"─".repeat(56)}${c.reset}`);
    console.log(`  ${badge("DONE", c.bgGreen)} ${c.green}${result.summary}${c.reset} ${c.dim}(${elapsed}s)${c.reset}\n`);
  } catch (err: unknown) {
    const errObj = err as Record<string, unknown>;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n${c.dim}${"─".repeat(56)}${c.reset}`);
    if (errObj.status === 401) {
      console.error(`  ${badge("ERROR", c.bgRed)} ${c.red}API authentication failed (401).${c.reset}`);
      console.error(`  ${c.dim}Check your API key: ~/.mimocoding/settings.json${c.reset} ${c.dim}(${elapsed}s)${c.reset}\n`);
    } else if (errObj.status === 404) {
      console.error(`  ${badge("ERROR", c.bgRed)} ${c.red}API endpoint not found (404).${c.reset}`);
      console.error(`  ${c.dim}Check baseURL in settings.${c.reset} ${c.dim}(${elapsed}s)${c.reset}\n`);
    } else {
      console.error(`  ${badge("ERROR", c.bgRed)} ${c.red}${err instanceof Error ? err.message : String(err)}${c.reset} ${c.dim}(${elapsed}s)${c.reset}\n`);
    }
  } finally {
    await sandbox.destroy();
  }
}

// ── REPL ──────────────────────────────────────────────────────

export async function startREPL(settings: Settings) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${c.cyan}${c.bold}> ${c.reset}`,
  });

  printBanner(settings);
  rl.prompt();

  rl.on("line", async (line: string) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    // Slash commands
    if (input.startsWith("/")) {
      const [cmd, ...args] = input.split(/\s+/);

      switch (cmd) {
        case "/help":
          showHelp();
          break;
        case "/provider": {
          const name = args[0];
          if (!name) {
            console.log(`\n  ${c.yellow}Usage:${c.reset} /provider <name>\n  ${c.dim}Available: ${Object.keys(settings.providers).join(", ")}${c.reset}\n`);
          } else if (!settings.providers[name]) {
            console.log(`\n  ${c.red}Unknown provider:${c.reset} "${name}"\n  ${c.dim}Available: ${Object.keys(settings.providers).join(", ")}${c.reset}\n`);
          } else {
            settings.activeProvider = name;
            console.log(`\n  ${c.green}Switched to:${c.reset} ${c.bold}${name}${c.reset} ${c.dim}(${settings.providers[name].model})${c.reset}\n`);
          }
          break;
        }
        case "/config":
          showConfig(settings);
          break;
        case "/clear":
          console.clear();
          printBanner(settings);
          break;
        case "/quit":
        case "/exit":
          rl.close();
          return;
        default:
          console.log(`\n  ${c.red}Unknown command:${c.reset} ${cmd}\n  ${c.dim}Type ${c.white}/help${c.dim} for available commands.${c.reset}\n`);
      }

      rl.prompt();
      return;
    }

    // Execute task
    await executeTask(input, settings);
    rl.prompt();
  });

  rl.on("close", () => {
    console.log(`\n  ${c.dim}Bye!${c.reset}\n`);
    process.exit(0);
  });
}
