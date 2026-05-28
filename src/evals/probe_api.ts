import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Settings } from "../config.js";

interface ProbeResult {
  name: string;
  success: boolean;
  data: unknown;
  error?: string;
}

async function sendRequest(
  endpoint: string,
  apiKey: string,
  body: Record<string, unknown>
): Promise<unknown> {
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${text}`);
  }

  return resp.json();
}

async function collectStreaming(
  endpoint: string,
  apiKey: string,
  body: Record<string, unknown>
): Promise<unknown[]> {
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "api-key": apiKey,
    },
    body: JSON.stringify({ ...body, stream: true }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${text}`);
  }

  const chunks: unknown[] = [];
  const reader = resp.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data: ")) continue;
      const data = trimmed.slice(6);
      if (data === "[DONE]") continue;
      try {
        chunks.push(JSON.parse(data));
      } catch {
        // skip malformed chunks
      }
    }
  }

  return chunks;
}

export async function probeApi(settings: Settings): Promise<void> {
  const provider = settings.providers[settings.activeProvider];
  if (!provider?.apiKey) {
    console.error("Error: No API key configured. Edit ~/.mimocoding/settings.json");
    process.exit(1);
  }

  const apiKey = provider.apiKey;
  const apiEndpoint = provider.baseURL.replace(/\/+$/, "") + "/chat/completions";
  const model = provider.model;

  console.log(`\nProbing API: ${apiEndpoint}`);
  console.log("=".repeat(60));

  const results: ProbeResult[] = [];

  // Test 1: Basic completion
  console.log("\n[1/6] Basic completion...");
  try {
    const data = await sendRequest(apiEndpoint, apiKey, {
      model,
      messages: [{ role: "user", content: "Say hello in one word." }],
      max_tokens: 50,
    });
    results.push({ name: "basic_completion", success: true, data });
    console.log("  OK");
  } catch (err) {
    results.push({ name: "basic_completion", success: false, data: null, error: String(err) });
    console.log(`  FAIL: ${err}`);
  }

  // Test 2: Tool calls
  console.log("\n[2/6] Tool call response...");
  try {
    const data = await sendRequest(apiEndpoint, apiKey, {
      model,
      messages: [{ role: "user", content: "List the files in the current directory." }],
      tools: [
        {
          type: "function",
          function: {
            name: "list_files",
            description: "List files in a directory",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string", description: "Directory path" },
              },
              required: ["path"],
            },
          },
        },
      ],
      max_tokens: 200,
    });
    results.push({ name: "tool_calls", success: true, data });
    console.log("  OK");
  } catch (err) {
    results.push({ name: "tool_calls", success: false, data: null, error: String(err) });
    console.log(`  FAIL: ${err}`);
  }

  // Test 3: Reasoning content (thinking mode)
  console.log("\n[3/6] Reasoning content (thinking mode)...");
  try {
    const data = await sendRequest(apiEndpoint, apiKey, {
      model,
      messages: [{ role: "user", content: "What is 2+2? Think step by step." }],
      max_tokens: 500,
    });
    const choice = (data as Record<string, unknown>).choices;
    const msg = Array.isArray(choice) ? (choice[0] as Record<string, unknown>)?.message : undefined;
    const hasReasoning = msg && typeof (msg as Record<string, unknown>).reasoning_content === "string";
    results.push({
      name: "reasoning_content",
      success: true,
      data: { hasReasoning, raw: data },
    });
    console.log(`  OK (hasReasoning: ${hasReasoning})`);
  } catch (err) {
    results.push({ name: "reasoning_content", success: false, data: null, error: String(err) });
    console.log(`  FAIL: ${err}`);
  }

  // Test 4: Multi-turn with reasoning_content replay
  console.log("\n[4/6] Multi-turn reasoning_content replay...");
  try {
    // First turn to get reasoning_content
    const first = await sendRequest(apiEndpoint, apiKey, {
      model,
      messages: [{ role: "user", content: "What is 15 * 17? Think step by step." }],
      max_tokens: 500,
    });
    const firstChoice = (first as Record<string, unknown>).choices;
    const firstMsg = Array.isArray(firstChoice)
      ? (firstChoice[0] as Record<string, unknown>)?.message
      : undefined;

    // Second turn replaying the assistant message
    const second = await sendRequest(apiEndpoint, apiKey, {
      model,
      messages: [
        { role: "user", content: "What is 15 * 17? Think step by step." },
        firstMsg as Record<string, unknown>,
        { role: "user", content: "Now what about 15 * 18?" },
      ],
      max_tokens: 500,
    });
    results.push({ name: "reasoning_replay", success: true, data: { first, second } });
    console.log("  OK");
  } catch (err) {
    results.push({ name: "reasoning_replay", success: false, data: null, error: String(err) });
    console.log(`  FAIL: ${err}`);
  }

  // Test 5: Streaming
  console.log("\n[5/6] Streaming chunks...");
  try {
    const chunks = await collectStreaming(apiEndpoint, apiKey, {
      model,
      messages: [{ role: "user", content: "Count from 1 to 5." }],
      max_tokens: 100,
    });
    results.push({
      name: "streaming",
      success: true,
      data: { chunkCount: chunks.length, sampleChunks: chunks.slice(0, 3) },
    });
    console.log(`  OK (${chunks.length} chunks)`);
  } catch (err) {
    results.push({ name: "streaming", success: false, data: null, error: String(err) });
    console.log(`  FAIL: ${err}`);
  }

  // Test 6: Error codes
  console.log("\n[6/6] Error handling (invalid model)...");
  try {
    const data = await sendRequest(apiEndpoint, apiKey, {
      model: "nonexistent-model-xyz",
      messages: [{ role: "user", content: "test" }],
    });
    results.push({ name: "error_codes", success: true, data });
    console.log("  OK (unexpected success)");
  } catch (err) {
    results.push({ name: "error_codes", success: true, data: null, error: String(err) });
    console.log("  OK (error returned as expected)");
  }

  // Write results
  const outputDir = join(process.cwd(), "evals", "responses");
  mkdirSync(outputDir, { recursive: true });
  const outputFile = join(outputDir, `probe_${new Date().toISOString().replace(/:/g, "-")}.json`);
  writeFileSync(outputFile, JSON.stringify(results, null, 2));

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("Summary:");
  for (const r of results) {
    console.log(`  ${r.success ? "PASS" : "FAIL"} ${r.name}`);
  }
  console.log(`\nResults saved to: ${outputFile}`);
}
