import { execSync, spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Sandbox, SandboxResult } from "./base.js";
import { CommandPolicy } from "./policy.js";

/**
 * 本地沙箱实现。
 *
 * 在本地 bash 进程中执行命令，通过 CommandPolicy 过滤危险命令。
 * 安全特性：
 * - 命令执行前经过 CommandPolicy 检查，阻止 rm -rf /、fork bomb 等
 * - 输出截断为 50K 字符，防止内存溢出
 * - 超时后发送 SIGKILL 强制终止
 * - TERM=dumb 禁用 ANSI 转义序列
 *
 * 注意：这是最轻量的沙箱，适合开发和测试。
 * 生产环境应使用 DockerSandbox 获得更强的隔离。
 */
export class LocalSandbox implements Sandbox {
  private policy = new CommandPolicy();
  private workDir: string;

  constructor(workDir: string) {
    this.workDir = resolve(workDir);
  }

  async execute(command: string, options?: { timeoutSec?: number }): Promise<SandboxResult> {
    // 命令策略检查：阻止危险命令
    const check = this.policy.check(command);
    if (!check.allowed) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: check.reason ?? "Command blocked by policy",
        truncated: false,
        timedOut: false,
      };
    }

    const timeoutMs = (options?.timeoutSec ?? 60) * 1000;
    const maxOutputChars = 50_000;

    return new Promise((resolve) => {
      const proc = spawn("bash", ["-c", command], {
        cwd: this.workDir,
        timeout: timeoutMs,
        env: { ...process.env, TERM: "dumb" },
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      // 超时保护：Node.js spawn 的 timeout 可能不可靠，手动设置 SIGKILL
      const timer = setTimeout(() => {
        proc.kill("SIGKILL");
      }, timeoutMs);

      proc.on("close", (code) => {
        clearTimeout(timer);
        resolve({
          exitCode: code ?? 1,
          stdout: stdout.slice(0, maxOutputChars),
          stderr: stderr.slice(0, maxOutputChars),
          truncated: stdout.length > maxOutputChars || stderr.length > maxOutputChars,
          timedOut: false,
        });
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        if ((err as NodeJS.ErrnoException).code === "ETIMEDOUT") {
          resolve({
            exitCode: -1,
            stdout: stdout.slice(0, maxOutputChars),
            stderr: "Command timed out",
            truncated: false,
            timedOut: true,
          });
        } else {
          resolve({
            exitCode: 1,
            stdout: "",
            stderr: err.message,
            truncated: false,
            timedOut: false,
          });
        }
      });
    });
  }

  /**
   * 读取文件内容，带行号前缀。
   * 输出格式：`行号\t内容`（类似 cat -n），方便模型定位代码位置。
   */
  async readFile(path: string, startLine?: number, endLine?: number): Promise<string> {
    const fullPath = resolve(this.workDir, path);

    if (!existsSync(fullPath)) {
      throw new Error(`File not found: ${path}`);
    }

    const content = readFileSync(fullPath, "utf-8");
    const lines = content.split("\n");

    const start = Math.max(1, startLine ?? 1);
    const end = Math.min(lines.length, endLine ?? lines.length);

    const selectedLines = lines.slice(start - 1, end);
    return selectedLines
      .map((line, i) => `${start + i}\t${line}`)
      .join("\n");
  }

  /** 列出目录条目，目录名带 / 后缀以便区分 */
  async listFiles(path: string): Promise<string[]> {
    const fullPath = resolve(this.workDir, path);

    if (!existsSync(fullPath)) {
      throw new Error(`Directory not found: ${path}`);
    }

    const entries = readdirSync(fullPath, { withFileTypes: true });
    return entries.map((e) => {
      const name = e.isDirectory() ? `${e.name}/` : e.name;
      return name;
    });
  }

  /** 本地沙箱无需清理资源 */
  async destroy(): Promise<void> {
    // Nothing to clean up for local sandbox
  }
}
