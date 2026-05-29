/**
 * MemoryIndex - MEMORY.md 索引管理器。
 *
 * MEMORY.md 是记忆系统的索引文件，始终被加载到对话上下文中。
 * 每条索引是一行简短的描述，指向对应的记忆文件。
 *
 * 格式：
 * ```
 * - [user_role](user_role.md) -- 用户是高级 Go 工程师
 * - [feedback_testing](feedback_testing.md) -- 集成测试必须使用真实数据库
 * ```
 *
 * 设计约束：
 * - MEMORY.md 是索引，不是记忆本身（内容写入独立 .md 文件）
 * - 每条索引一行，不超过 150 字符
 * - 索引超过 maxIndexLines 行时截断并警告
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { MemoryEntry, MemoryIndexEntry } from "./types.js";

/** 索引文件名 */
const INDEX_FILE = "MEMORY.md";

/**
 * 解析 MEMORY.md 内容为索引条目列表。
 * 每行格式：- [title](filename.md) -- description
 */
function parseIndex(content: string): MemoryIndexEntry[] {
  const entries: MemoryIndexEntry[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    // 匹配 - [title](filename.md) -- description 或 - [title](filename.md)
    const match = trimmed.match(/^- \[(.+?)\]\((.+?)\)(?:\s*--\s*(.+))?$/);
    if (match) {
      entries.push({
        title: match[1],
        fileName: match[2],
        description: match[3]?.trim() ?? "",
      });
    }
  }

  return entries;
}

/**
 * 将索引条目列表序列化为 MEMORY.md 内容。
 */
function serializeIndex(entries: MemoryIndexEntry[]): string {
  const lines = entries.map((e) => {
    const desc = e.description ? ` -- ${e.description}` : "";
    return `- [${e.title}](${e.fileName})${desc}`;
  });
  return lines.join("\n") + "\n";
}

/**
 * MEMORY.md 索引管理器。
 * 负责读取、更新和维护记忆索引文件。
 */
export class MemoryIndex {
  private indexPath: string;
  private maxLines: number;

  constructor(memoryDir: string, maxLines = 200) {
    this.indexPath = join(memoryDir, INDEX_FILE);
    this.maxLines = maxLines;
  }

  /**
   * 读取索引。
   * 索引文件不存在时返回空数组。
   */
  load(): MemoryIndexEntry[] {
    if (!existsSync(this.indexPath)) return [];

    try {
      const content = readFileSync(this.indexPath, "utf-8");
      return parseIndex(content);
    } catch {
      return [];
    }
  }

  /**
   * 从 MemoryEntry 列表重建索引并写入 MEMORY.md。
   * 这是最安全的更新方式——基于当前 store 的完整状态重建。
   */
  rebuildFromEntries(entries: MemoryEntry[]): void {
    const indexEntries: MemoryIndexEntry[] = entries.map((e) => ({
      title: e.name,
      fileName: `${e.name}.md`,
      description: e.description,
    }));

    // 按类型分组排序，使索引更有组织性
    const typeOrder = { user: 0, project: 1, reference: 2, feedback: 3 };
    indexEntries.sort((a, b) => {
      const entryA = entries.find((e) => e.name === a.title);
      const entryB = entries.find((e) => e.name === b.title);
      const orderA = entryA ? typeOrder[entryA.type] : 99;
      const orderB = entryB ? typeOrder[entryB.type] : 99;
      return orderA - orderB;
    });

    const content = serializeIndex(indexEntries);
    const lines = content.split("\n").filter((l) => l.trim());

    if (lines.length > this.maxLines) {
      console.warn(
        `WARNING: MEMORY.md has ${lines.length} lines. ` +
        `Only the first ${this.maxLines} will be loaded. ` +
        `Keep index entries concise; move detail into topic files.`
      );
    }

    writeFileSync(this.indexPath, content, "utf-8");
  }

  /**
   * 添加一条索引条目（增量更新）。
   * 如果同名条目已存在则更新描述。
   */
  addEntry(entry: MemoryIndexEntry): void {
    const entries = this.load();
    const existingIdx = entries.findIndex((e) => e.fileName === entry.fileName);

    if (existingIdx >= 0) {
      entries[existingIdx] = entry;
    } else {
      entries.push(entry);
    }

    const content = serializeIndex(entries);
    writeFileSync(this.indexPath, content, "utf-8");
  }

  /**
   * 移除一条索引条目。
   */
  removeEntry(fileName: string): void {
    const entries = this.load().filter((e) => e.fileName !== fileName);
    const content = serializeIndex(entries);
    writeFileSync(this.indexPath, content, "utf-8");
  }

  /**
   * 获取 MEMORY.md 的原始内容（用于注入 system prompt）。
   * 如果文件不存在返回空字符串。
   */
  getRawContent(): string {
    if (!existsSync(this.indexPath)) return "";

    try {
      return readFileSync(this.indexPath, "utf-8");
    } catch {
      return "";
    }
  }
}
