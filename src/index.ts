#!/usr/bin/env node
import { Command } from "commander";
import { loadSettings, initConfig, CONFIG_DIR } from "./config.js";
import { startREPL, executeTask } from "./repl.js";

const program = new Command();

program
  .name("mimocoding")
  .description("AI coding agent powered by MiMo — interactive REPL or one-shot mode")
  .version("0.1.0");

// Default command: no subcommand, just a task or nothing
program
  .argument("[task]", "Task description (omit to enter interactive mode)")
  .option("--provider <name>", "Override active provider")
  .action(async (task: string | undefined, opts: Record<string, unknown>) => {
    const settings = loadSettings();

    if (opts.provider) {
      if (!settings.providers[opts.provider as string]) {
        console.error(`Unknown provider: "${opts.provider}". Available: ${Object.keys(settings.providers).join(", ")}`);
        process.exit(1);
      }
      settings.activeProvider = opts.provider as string;
    }

    if (!task) {
      // Interactive REPL mode
      const { startREPL } = await import("./repl.js");
      await startREPL(settings);
    } else {
      // One-shot mode
      await executeTask(task, settings);
    }
  });

// init subcommand
program
  .command("init")
  .description("Initialize config at ~/.mimocoding/settings.json")
  .action(() => {
    const path = initConfig();
    console.log(`Config created at: ${path}`);
    console.log(`\nEdit the file and set your API key:`);
    console.log(`  ${path}`);
    console.log(`\nThen run: mimocoding`);
  });

// eval subcommands
program
  .command("eval:probe")
  .description("Probe the API to verify protocol details")
  .action(async () => {
    const settings = loadSettings();
    const { probeApi } = await import("./evals/probe_api.js");
    await probeApi(settings);
  });

program
  .command("eval:tools")
  .description("Run tool-call reliability evaluations")
  .action(async () => {
    const settings = loadSettings();
    const { runToolCallEval } = await import("./evals/tool_call_eval.js");
    await runToolCallEval(settings);
  });

program
  .command("eval:coding")
  .description("Run coding task evaluations")
  .action(async () => {
    const settings = loadSettings();
    const { runCodingEval } = await import("./evals/coding_eval.js");
    await runCodingEval(settings);
  });

program.parse();
