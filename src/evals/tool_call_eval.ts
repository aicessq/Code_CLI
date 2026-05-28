import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Settings } from "../config.js";
import { EvalRunner, type EvalCase } from "./runner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): EvalCase {
  const path = join(__dirname, "fixtures", "tool_call", `${name}.yaml`);
  const raw = readFileSync(path, "utf-8");
  // Simple YAML-like parser for our fixture format
  return parseSimpleYaml(raw);
}

function parseSimpleYaml(raw: string): EvalCase {
  // Minimal YAML parser for our fixture format
  const lines = raw.split("\n");
  const result: Record<string, unknown> = {};
  let currentSection = "";
  let currentList: Record<string, unknown>[] = [];
  let currentItem: Record<string, unknown> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (trimmed.startsWith("- type:")) {
      if (Object.keys(currentItem).length > 0) {
        currentList.push(currentItem);
      }
      currentItem = { type: trimmed.split(":")[1].trim() };
      currentSection = "assertions";
    } else if (trimmed.startsWith("params:")) {
      // params are on next lines
    } else if (trimmed.startsWith("type:") && !trimmed.startsWith("- type:")) {
      // skip if in assertion context
    } else if (trimmed.includes(":") && !trimmed.startsWith("-")) {
      const [key, ...valueParts] = trimmed.split(":");
      const value = valueParts.join(":").trim();
      if (currentSection === "assertions" || Object.keys(currentItem).length > 0) {
        if (key.trim() === "tool" || key.trim() === "min" || key.trim() === "pattern" || key.trim() === "file" || key.trim() === "command") {
          if (!currentItem.params) currentItem.params = {};
          (currentItem.params as Record<string, unknown>)[key.trim()] = isNaN(Number(value)) ? value.replace(/"/g, "") : Number(value);
        }
      } else {
        result[key.trim()] = value.replace(/"/g, "");
      }
    }
  }

  if (Object.keys(currentItem).length > 0) {
    currentList.push(currentItem);
  }

  result.assertions = currentList;
  return result as unknown as EvalCase;
}

export async function runToolCallEval(settings: Settings): Promise<void> {
  console.log("Running tool call evaluations...\n");

  const fixtureNames = ["simple_tool", "multi_turn_tool", "invalid_args_repair"];
  const cases: EvalCase[] = [];

  for (const name of fixtureNames) {
    try {
      cases.push(loadFixture(name));
    } catch (err) {
      console.warn(`Warning: Could not load fixture ${name}: ${err}`);
    }
  }

  if (cases.length === 0) {
    console.log("No fixtures found. Creating default test cases...");

    cases.push(
      {
        name: "simple_tool_call",
        task: "List all files in the current directory using the list_files tool, then call finish with the count.",
        assertions: [
          { type: "tool_call_count", params: { tool: "list_files", min: 1 } },
          { type: "tool_call_count", params: { tool: "finish", min: 1 } },
        ],
      },
      {
        name: "multi_turn_tool",
        task: "Read the file README.md (if it exists), then list files in the current directory. Call finish with a summary of what you found.",
        assertions: [
          { type: "tool_call_count", params: { tool: "finish", min: 1 } },
        ],
      }
    );
  }

  const runner = new EvalRunner();
  const report = await runner.run(cases, settings);

  console.log("\n" + "=".repeat(60));
  console.log(`Profile: ${report.profile}`);
  console.log(`Passed: ${report.summary.passed}/${report.summary.total} (${(report.summary.passRate * 100).toFixed(1)}%)`);
  console.log(`Avg steps: ${report.summary.avgSteps.toFixed(1)}`);
  console.log(`Avg tool calls: ${report.summary.avgToolCalls.toFixed(1)}`);
  console.log("=".repeat(60));
}
