/**
 * MemoryLoader - 三层记忆加载器。
 *
 * 参考 Claude Code 的记忆分层机制，支持三个作用域：
 * - global: 全局用户记忆（~/.mimocoding/memory/），跨所有项目生效
 * - project: 项目记忆（<project>/.mimocoding/memory/），可提交 git 共享
 * - local: 本地记忆（<project>/.mimocoding/memory-local/），不提交版本控制
 *
 * 每个作用域有独立的 MemoryStore 和 MemoryIndex。
 * buildMemoryContext() 合并三层索引，按 scope 分组注入 system prompt。
 */
import { MemoryStore } from "./store.js";
import { MemoryIndex } from "./index.js";
import type { MemoryEntry, MemoryConfig, MemoryScope } from "./types.js";
import { SCOPE_LABELS } from "./types.js";

/**
 * 三层记忆加载器。
 * 管理三个 scope 的存储和索引，提供统一的读写接口。
 */
export class MemoryLoader {
  private stores: Record<MemoryScope, MemoryStore>;
  private indexes: Record<MemoryScope, MemoryIndex>;
  private config: MemoryConfig;

  constructor(config: MemoryConfig) {
    this.config = config;

    // 为每个 scope 创建独立的 store 和 index
    this.stores = {
      global: new MemoryStore(config.globalDir),
      project: new MemoryStore(config.projectDir),
      local: new MemoryStore(config.localDir),
    };

    this.indexes = {
      global: new MemoryIndex(config.globalDir, config.maxIndexLines),
      project: new MemoryIndex(config.projectDir, config.maxIndexLines),
      local: new MemoryIndex(config.localDir, config.maxIndexLines),
    };
  }

  /**
   * 构建记忆上下文字符串（注入 system prompt）。
   * 合并三层索引，按 scope 分组展示：
   *
   * ```
   * ## Known Memories
   *
   * ### Global (user preferences)
   * - [user_language](user_language.md) -- 回答用中文
   *
   * ### Project
   * - [project_auth](project_auth.md) -- 使用 JWT
   *
   * ### Local (not committed)
   * - [ref_api](ref_api.md) -- 内网 API 文档
   * ```
   */
  buildMemoryContext(): string {
    if (!this.config.enabled) return "";

    const sections: string[] = [];
    let hasAny = false;

    for (const scope of ["global", "project", "local"] as MemoryScope[]) {
      const raw = this.indexes[scope].getRawContent();
      if (!raw.trim()) continue;

      if (!hasAny) {
        sections.push("## Known Memories", "");
        hasAny = true;
      }

      const lines = raw.split("\n").filter((l) => l.trim());

      // 截断过长的索引
      if (lines.length > this.config.maxIndexLines) {
        lines.splice(this.config.maxIndexLines);
        sections.push(`[Note: some older ${scope} memory entries were truncated]`);
      }

      sections.push(`### ${SCOPE_LABELS[scope]}`, "");
      sections.push(...lines, "");
    }

    return sections.join("\n");
  }

  /**
   * 保存记忆并更新对应 scope 的索引。
   * 根据 entry.scope 决定写入哪个目录。
   */
  saveMemory(entry: MemoryEntry): void {
    const scope = entry.scope;
    this.stores[scope].save(entry);
    this.indexes[scope].addEntry({
      title: entry.name,
      fileName: `${entry.name}.md`,
      description: entry.description,
    });
  }

  /**
   * 删除指定 scope 的记忆。
   */
  deleteMemory(name: string, scope: MemoryScope): boolean {
    const deleted = this.stores[scope].delete(name);
    if (deleted) {
      this.indexes[scope].removeEntry(`${name}.md`);
    }
    return deleted;
  }

  /**
   * 列出所有 scope 的记忆。
   */
  listMemories(): MemoryEntry[] {
    const all: MemoryEntry[] = [];
    for (const scope of ["global", "project", "local"] as MemoryScope[]) {
      const entries = this.stores[scope].list();
      // 确保每条记忆的 scope 字段正确（兼容旧文件）
      for (const e of entries) {
        e.scope = scope;
      }
      all.push(...entries);
    }
    return all;
  }

  /**
   * 加载指定 scope 的单条记忆。
   */
  loadMemory(name: string, scope: MemoryScope): MemoryEntry | null {
    return this.stores[scope].load(name);
  }

  /** 获取指定 scope 的 store（供工具使用） */
  getStore(scope: MemoryScope): MemoryStore {
    return this.stores[scope];
  }

  /** 获取指定 scope 的 index（供工具使用） */
  getIndex(scope: MemoryScope): MemoryIndex {
    return this.indexes[scope];
  }
}
