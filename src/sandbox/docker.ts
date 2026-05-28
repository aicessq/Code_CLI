/**
 * DockerSandbox - Docker 容器沙盒
 *
 * 在 Docker 容器中执行命令，提供安全隔离的执行环境。
 * 这是生产环境使用的沙盒实现。
 *
 * 安全特性:
 * - 默认禁用网络（NetworkDisabled: true）
 * - 资源限制: 512MB 内存，50% CPU
 * - 危险命令阻止（CommandPolicy）
 * - 输出截断: 50,000 字符
 * - 超时控制
 *
 * 使用方式:
 *   const sandbox = await DockerSandbox.create({
 *     image: "code-agent-sandbox:latest",
 *     hostDir: "/path/to/project",
 *     networkDisabled: true,
 *   });
 *   const result = await sandbox.execute("ls -la");
 *   await sandbox.destroy();
 *
 * 镜像要求:
 * - 基于 node:20-slim
 * - 安装 git, ripgrep, bash
 * - 使用非 root 用户 (agent)
 * - 工作目录 /workspace
 *
 * 注意: 使用前需要先构建镜像:
 *   docker build -t code-agent-sandbox:latest -f Dockerfile.sandbox .
 */
import Docker from "dockerode";
import type { Sandbox, SandboxResult } from "./base.js";
import { CommandPolicy } from "./policy.js";

/** DockerSandbox 创建选项 */
export interface DockerSandboxOptions {
  /** Docker 镜像名称，如 "code-agent-sandbox:latest" */
  image: string;
  /** 宿主目录路径，会挂载到容器的 /workspace */
  hostDir: string;
  /** 全局超时（秒），默认不限制 */
  timeoutSec?: number;
  /** 是否禁用网络，默认 true（安全考虑） */
  networkDisabled?: boolean;
}

/**
 * Docker 容器沙盒实现
 *
 * 生命周期:
 * 1. create() → 创建并启动容器
 * 2. execute() / readFile() / listFiles() → 在容器中执行操作
 * 3. destroy() → 停止并移除容器
 */
export class DockerSandbox implements Sandbox {
  private docker: Docker;
  private container: Docker.Container | null = null;
  private workDir = "/workspace";  // 容器内的工作目录
  private policy = new CommandPolicy();  // 危险命令检查策略
  private options: DockerSandboxOptions;

  private constructor(options: DockerSandboxOptions) {
    this.docker = new Docker();  // 连接到本地 Docker daemon
    this.options = options;
  }

  /**
   * 工厂方法: 创建并初始化 DockerSandbox
   *
   * 使用工厂方法而非构造函数，因为容器创建是异步操作。
   */
  static async create(options: DockerSandboxOptions): Promise<DockerSandbox> {
    const sandbox = new DockerSandbox(options);
    await sandbox.init();
    return sandbox;
  }

  /**
   * 初始化容器
   *
   * 配置:
   * - Tty: false（不需要伪终端）
   * - OpenStdin: false（不需要交互式输入）
   * - NetworkDisabled: 默认 true（安全考虑）
   * - Memory: 512MB（防止内存泄漏）
   * - CpuQuota: 50000（50% CPU，防止 CPU 耗尽）
   * - Binds: 宿主目录挂载到 /workspace
   */
  private async init(): Promise<void> {
    this.container = await this.docker.createContainer({
      Image: this.options.image,
      Tty: false,
      OpenStdin: false,
      NetworkDisabled: this.options.networkDisabled ?? true,
      HostConfig: {
        Binds: [`${this.options.hostDir}:${this.workDir}`],
        AutoRemove: false,  // 手动管理容器生命周期
        Memory: 512 * 1024 * 1024, // 512MB 内存限制
        CpuQuota: 50000, // 50% of one core（防止 CPU 耗尽）
      },
      WorkingDir: this.workDir,
    });

    await this.container.start();
  }

  /**
   * 在容器中执行命令
   *
   * 流程:
   * 1. 检查 CommandPolicy（阻止危险命令）
   * 2. 在容器中创建 exec 实例
   * 3. 启动 exec 并收集输出
   * 4. 截断过长的输出
   *
   * @param command - 要执行的 shell 命令
   * @param options - 可选配置（超时时间）
   * @returns 执行结果（exitCode, stdout, stderr, truncated, timedOut）
   */
  async execute(command: string, options?: { timeoutSec?: number }): Promise<SandboxResult> {
    if (!this.container) throw new Error("Sandbox not initialized");

    // 检查危险命令
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

    const timeoutSec = options?.timeoutSec ?? 60;
    const maxOutputChars = 50_000;  // 输出截断限制

    try {
      // 在容器中创建 exec 实例
      const exec = await this.container.exec({
        Cmd: ["/bin/bash", "-c", command],
        AttachStdout: true,
        AttachStderr: true,
        WorkingDir: this.workDir,
      });

      // 启动 exec 并收集输出
      const stream = await exec.start({ Detach: false });
      const output = await this.collectStream(stream, timeoutSec);

      // 获取退出码
      const inspect = await exec.inspect();

      return {
        exitCode: inspect.ExitCode ?? 0,
        stdout: output.stdout.slice(0, maxOutputChars),
        stderr: output.stderr.slice(0, maxOutputChars),
        truncated: output.stdout.length > maxOutputChars || output.stderr.length > maxOutputChars,
        timedOut: output.timedOut,
      };
    } catch (err) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: `Docker exec error: ${err instanceof Error ? err.message : String(err)}`,
        truncated: false,
        timedOut: false,
      };
    }
  }

  /**
   * 收集流式输出
   *
   * Docker 的输出流是多路复用的（stdout 和 stderr 合并）。
   * 第一个字节标识流类型: 0=stdin, 1=stdout, 2=stderr。
   * 当前简化处理，全部作为 stdout。
   */
  private collectStream(stream: NodeJS.ReadWriteStream, timeoutSec: number): Promise<{ stdout: string; stderr: string; timedOut: boolean }> {
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;

      // 超时定时器
      const timer = setTimeout(() => {
        timedOut = true;
        if ("destroy" in stream && typeof (stream as NodeJS.ReadStream).destroy === "function") {
          (stream as NodeJS.ReadStream).destroy();
        } else {
          stream.end();
        }
      }, timeoutSec * 1000);

      stream.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      stream.on("end", () => {
        clearTimeout(timer);
        resolve({ stdout, stderr, timedOut });
      });

      stream.on("error", () => {
        clearTimeout(timer);
        resolve({ stdout, stderr, timedOut });
      });
    });
  }

  /**
   * 在容器中读取文件
   *
   * 使用 sed 命令提取指定行范围，并添加行号。
   * 如果不指定行范围，读取整个文件。
   */
  async readFile(path: string, startLine?: number, endLine?: number): Promise<string> {
    let cmd = `cat "${path}"`;
    if (startLine !== undefined || endLine !== undefined) {
      const start = startLine ?? 1;
      const end = endLine ?? 999999;
      cmd = `sed -n '${start},${end}p' "${path}" | nl -ba -nln -v${start}`;
    }

    const result = await this.execute(cmd, { timeoutSec: 10 });
    if (result.exitCode !== 0) {
      throw new Error(`Failed to read file: ${result.stderr}`);
    }
    return result.stdout;
  }

  /**
   * 列出容器中的文件
   *
   * 使用 ls -1 命令，返回文件名列表。
   */
  async listFiles(path: string): Promise<string[]> {
    const result = await this.execute(`ls -1 "${path}"`, { timeoutSec: 10 });
    if (result.exitCode !== 0) {
      throw new Error(`Failed to list files: ${result.stderr}`);
    }
    return result.stdout.trim().split("\n").filter(Boolean);
  }

  /**
   * 销毁容器
   *
   * 停止并移除容器，释放资源。
   * 应在 Agent 运行结束后调用。
   */
  async destroy(): Promise<void> {
    if (this.container) {
      try {
        await this.container.stop();
      } catch {
        // 容器可能已停止
      }
      try {
        await this.container.remove();
      } catch {
        // 容器可能已移除
      }
      this.container = null;
    }
  }
}
