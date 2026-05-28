import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function findPromptsDir(): string {
  // When running from dist/, prompts are at ../src/prompts/ or ../prompts/
  // When running from src/ (via tsx), prompts are at ../prompts/
  const candidates = [
    join(__dirname, "..", "prompts"),           // src/agent -> src/prompts  OR  dist/agent -> dist/prompts
    join(__dirname, "..", "..", "src", "prompts"), // dist/agent -> src/prompts
  ];

  for (const dir of candidates) {
    if (existsSync(join(dir, "generic_coding_agent.md"))) {
      return dir;
    }
  }

  throw new Error(`Prompts directory not found. Searched: ${candidates.join(", ")}`);
}

export class PromptLoader {
  private cache = new Map<string, string>();
  private promptsDir = findPromptsDir();

  load(profileName: string): string {
    const cached = this.cache.get(profileName);
    if (cached) return cached;

    const promptPath = join(this.promptsDir, `${profileName}.md`);
    try {
      const content = readFileSync(promptPath, "utf-8");
      this.cache.set(profileName, content);
      return content;
    } catch {
      // Fallback to generic prompt
      if (profileName !== "generic_coding_agent") {
        console.warn(`Prompt "${profileName}" not found, falling back to generic_coding_agent`);
        return this.load("generic_coding_agent");
      }
      throw new Error(`Prompt file not found: ${promptPath}`);
    }
  }
}
