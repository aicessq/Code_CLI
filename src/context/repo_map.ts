import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", "__pycache__", ".venv", "venv"]);
const MAX_DEPTH = 3;
const MAX_FILES = 200;

export class RepoMap {
  generate(rootDir: string): string {
    const lines: string[] = [];
    this.walk(rootDir, rootDir, 0, lines, { count: 0 });
    return lines.join("\n");
  }

  private walk(currentDir: string, rootDir: string, depth: number, lines: string[], counter: { count: number }): void {
    if (depth > MAX_DEPTH || counter.count >= MAX_FILES) return;

    let entries: string[];
    try {
      entries = readdirSync(currentDir);
    } catch {
      return;
    }

    // Sort: directories first, then files
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

    for (const dir of dirs.sort()) {
      if (counter.count >= MAX_FILES) break;
      const relPath = relative(rootDir, join(currentDir, dir));
      lines.push(`${indent}${dir}/`);
      this.walk(join(currentDir, dir), rootDir, depth + 1, lines, counter);
    }

    for (const file of files.sort()) {
      if (counter.count >= MAX_FILES) break;
      counter.count++;
      lines.push(`${indent}${file}`);
    }

    if (counter.count >= MAX_FILES && depth === 0) {
      lines.push("... (file listing truncated)");
    }
  }
}
