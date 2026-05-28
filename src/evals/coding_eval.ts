import type { Settings } from "../config.js";
import { EvalRunner, type EvalCase } from "./runner.js";

export async function runCodingEval(settings: Settings): Promise<void> {
  console.log("Running coding evaluations...\n");

  const cases: EvalCase[] = [
    {
      name: "python_bug_001: fix off-by-one",
      task: `There is a bug in src/counter.py: count_up_to(5) should return [0,1,2,3,4,5] but it returns [0,1,2,3,4]. Fix the bug and verify.`,
      fixtures: {
        "src/counter.py": `def count_up_to(n):
    result = []
    i = 0
    while i < n:  # BUG: should be i <= n
        result.append(i)
        i += 1
    return result
`,
      },
      assertions: [
        { type: "file_contains", params: { file: "src/counter.py", pattern: "i <= n|range\\(n.*\\+.*1\\)" } },
      ],
    },
    {
      name: "js_bug_001: fix array sum",
      task: `There is a bug in src/sum.js: sumArray([1,2,3]) should return 6 but it returns undefined. Fix the bug.`,
      fixtures: {
        "src/sum.js": `function sumArray(arr) {
  let total = 0;
  for (let i = 0; i <= arr.length; i++) {  // BUG: should be i < arr.length
    total += arr[i];
  }
  // BUG: missing return statement
}
module.exports = { sumArray };
`,
      },
      assertions: [
        { type: "file_contains", params: { file: "src/sum.js", pattern: "return total|return.*total" } },
        { type: "file_contains", params: { file: "src/sum.js", pattern: "i < arr\\.length" } },
      ],
    },
    {
      name: "python_add_function",
      task: `Create a new file src/math_utils.py with a function add(a, b) that returns the sum of a and b. Add a docstring.`,
      fixtures: {},
      assertions: [
        { type: "file_exists", params: { file: "src/math_utils.py" } },
        { type: "file_contains", params: { file: "src/math_utils.py", pattern: "def add" } },
        { type: "file_contains", params: { file: "src/math_utils.py", pattern: "return.*a.*\\+.*b|return.*\\+" } },
      ],
    },
  ];

  const runner = new EvalRunner();
  const report = await runner.run(cases, settings);

  console.log("\n" + "=".repeat(60));
  console.log(`Profile: ${report.profile}`);
  console.log(`Passed: ${report.summary.passed}/${report.summary.total} (${(report.summary.passRate * 100).toFixed(1)}%)`);
  console.log(`Avg steps: ${report.summary.avgSteps.toFixed(1)}`);
  console.log(`Avg tool calls: ${report.summary.avgToolCalls.toFixed(1)}`);

  for (const r of report.cases) {
    console.log(`\n  ${r.passed ? "PASS" : "FAIL"} ${r.name} (${r.durationMs}ms)`);
    for (const a of r.assertionResults) {
      console.log(`    ${a.passed ? "OK" : "FAIL"} ${a.assertion.type}: ${a.detail}`);
    }
  }

  console.log("=".repeat(60));
}
