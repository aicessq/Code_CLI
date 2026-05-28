import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * 查找 prompts 目录。
 * 兼容两种运行方式：
 * - tsx src/index.ts: __dirname = src/agent → prompts 在 src/prompts/
 * - node dist/index.js: __dirname = dist/agent → prompts 在 dist/prompts/ 或 src/prompts/
 */
function findPromptsDir(): string {
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

/**
 * 系统 prompt 加载器。
 *
 * 从 src/prompts/ 目录加载 .md 格式的 prompt 模板。
 * 支持按 profileName 加载特定 prompt（如 mimo_coding_agent），
 * 找不到时自动回退到 generic_coding_agent。
 * 加载结果会被缓存，避免重复读取文件。
 */
export class PromptLoader {
  private cache = new Map<string, string>();
  private promptsDir = findPromptsDir();

  /**
   * 加载指定名称的 prompt。
   * @param profileName - prompt 文件名（不含 .md 扩展名）
   * @returns prompt 内容字符串，找不到时回退到 generic_coding_agent
   */
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
