import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** 忽略的目录：依赖、构建产物、Python 虚拟环境等 */
const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", "__pycache__", ".venv", "venv"]);
/** 最大递归深度 */
const MAX_DEPTH = 3;
/** 最大文件数限制，防止超大仓库生成过长的目录树 */
const MAX_FILES = 200;

/**
 * 仓库目录树生成器。
 *
 * 生成项目的目录树字符串，用于 system prompt 中让模型了解项目结构。
 * 已构建但尚未集成到 agent loop 中。
 *
 * 特性：
 * - 自动忽略 node_modules、.git 等无关目录
 * - 最大深度 3 层，最大 200 个文件
 * - 目录排在文件前面，各自按字母排序
 * - 目录名带 / 后缀以便区分
 */
export class RepoMap {
  /**
   * 生成目录树字符串。
   * @param rootDir - 项目根目录
   * @returns 格式化的目录树，每行带缩进表示层级
   */
  generate(rootDir: string): string {
    const lines: string[] = [];
    this.walk(rootDir, rootDir, 0, lines, { count: 0 });
    return lines.join("\n");
  }

  /** 递归遍历目录，构建缩进格式的目录树 */
  private walk(currentDir: string, rootDir: string, depth: number, lines: string[], counter: { count: number }): void {
    if (depth > MAX_DEPTH || counter.count >= MAX_FILES) return;

    let entries: string[];
    try {
      entries = readdirSync(currentDir);
    } catch {
      return;
    }

    // 分离目录和文件，分别排序
    const dirs: string[] = [];
    const files: string[] = [];

    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry) || entry.startsWith(".")) continue;

      const fullPath = join(currentDir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          dirs.push(entry);
        } else {
          files.push(entry);
        }
      } catch {
        continue;
      }
    }

    const indent = "  ".repeat(depth);

    // 目录优先，递归展开
    for (const dir of dirs.sort()) {
      if (counter.count >= MAX_FILES) break;
      const relPath = relative(rootDir, join(currentDir, dir));
      lines.push(`${indent}${dir}/`);
      this.walk(join(currentDir, dir), rootDir, depth + 1, lines, counter);
    }

    // 文件列表
    for (const file of files.sort()) {
      if (counter.count >= MAX_FILES) break;
      counter.count++;
      lines.push(`${indent}${file}`);
    }

    // 超出限制时添加截断提示
    if (counter.count >= MAX_FILES && depth === 0) {
      lines.push("... (file listing truncated)");
    }
  }
}
