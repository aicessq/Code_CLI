/**
 * MemoryStore - 文件系统记忆存储。
 *
 * 将记忆持久化为 .md 文件（带 YAML frontmatter），存储在记忆目录中。
 * 文件命名：<type>_<topic>.md（如 user_role.md、feedback_testing.md）
 *
 * 文件格式：
 * ```
 * ---
 * name: user_role
 * description: 用户是高级 Go 工程师
 * type: user
 * scope: global
 * created: 2026-05-29T10:00:00.000Z
 * ---
 *
 * 用户有 10 年 Go 经验，熟悉微服务架构。
 * ```
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, unlinkSync } from "node:fs";
import { join, basename } from "node:path";
import type { MemoryEntry, MemoryType, MemoryScope } from "./types.js";

/** YAML frontmatter 分隔符 */
const FRONTMATTER_DELIMITER = "---";

/**
 * 从 .md 文件内容解析 MemoryEntry。
 * 解析 YAML frontmatter 和 Markdown body。
 */
function parseMemoryFile(filePath: string, content: string): MemoryEntry | null {
  const lines = content.split("\n");

  // 查找 frontmatter 边界
  if (lines[0]?.trim() !== FRONTMATTER_DELIMITER) return null;

  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === FRONTMATTER_DELIMITER) {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) return null;

  // 解析 frontmatter 键值对
  const meta: Record<string, string> = {};
  for (let i = 1; i < endIdx; i++) {
    const line = lines[i];
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    meta[key] = value;
  }

  const body = lines.slice(endIdx + 1).join("\n").trim();

  return {
    name: meta.name ?? basename(filePath, ".md"),
    description: meta.description ?? "",
    type: (meta.type as MemoryType) ?? "project",
    scope: (meta.scope as MemoryScope) ?? "global",
    created: meta.created ?? new Date().toISOString(),
    content: body,
    filePath,
  };
}

/**
 * 将 MemoryEntry 序列化为 .md 文件内容。
 */
function serializeMemoryFile(entry: MemoryEntry): string {
  const frontmatter = [
    FRONTMATTER_DELIMITER,
    `name: ${entry.name}`,
    `description: ${entry.description}`,
    `type: ${entry.type}`,
    `scope: ${entry.scope}`,
    `created: ${entry.created}`,
    FRONTMATTER_DELIMITER,
  ].join("\n");

  return `${frontmatter}\n\n${entry.content}\n`;
}

/**
 * 文件系统记忆存储。
 *
 * 提供记忆的 CRUD 操作，所有记忆以 .md 文件形式存储在记忆目录中。
 */
export class MemoryStore {
  constructor(private memoryDir: string) {
    mkdirSync(memoryDir, { recursive: true });
  }

  /**
   * 保存一条记忆。
   * 如果同名文件已存在则覆盖。
   */
  save(entry: MemoryEntry): void {
    const fileName = `${entry.name}.md`;
    const filePath = join(this.memoryDir, fileName);
    const content = serializeMemoryFile(entry);
    writeFileSync(filePath, content, "utf-8");
  }

  /**
   * 读取一条记忆。
   * @returns MemoryEntry 或 null（文件不存在或解析失败）
   */
  load(name: string): MemoryEntry | null {
    const filePath = join(this.memoryDir, `${name}.md`);
    if (!existsSync(filePath)) return null;

    try {
      const content = readFileSync(filePath, "utf-8");
      return parseMemoryFile(filePath, content);
    } catch {
      return null;
    }
  }

  /**
   * 列出所有记忆。
   * 扫描目录中的 .md 文件并解析 frontmatter。
   */
  list(): MemoryEntry[] {
    if (!existsSync(this.memoryDir)) return [];

    const entries: MemoryEntry[] = [];
    const files = readdirSync(this.memoryDir).filter((f) => f.endsWith(".md") && f !== "MEMORY.md");

    for (const file of files) {
      try {
        const filePath = join(this.memoryDir, file);
        const content = readFileSync(filePath, "utf-8");
        const entry = parseMemoryFile(filePath, content);
        if (entry) entries.push(entry);
      } catch {
        // 跳过解析失败的文件
      }
    }

    return entries;
  }

  /**
   * 删除一条记忆。
   */
  delete(name: string): boolean {
    const filePath = join(this.memoryDir, `${name}.md`);
    if (!existsSync(filePath)) return false;

    try {
      unlinkSync(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 检查记忆是否存在。
   */
  exists(name: string): boolean {
    return existsSync(join(this.memoryDir, `${name}.md`));
  }
}
