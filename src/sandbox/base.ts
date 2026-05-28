/**
 * 沙箱执行结果。
 * 包含命令的退出码、输出内容以及状态标志（截断、超时）。
 */
export interface SandboxResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** 输出是否被截断（超过最大输出字符数限制） */
  truncated: boolean;
  /** 命令是否因超时被终止 */
  timedOut: boolean;
}

/**
 * 沙箱抽象接口。
 * 定义命令执行和文件操作的统一接口，由 LocalSandbox 和 DockerSandbox 实现。
 * 工具通过此接口与文件系统交互，不直接操作文件，确保隔离性。
 */
export interface Sandbox {
  /** 执行 shell 命令，返回结果包含 stdout/stderr 和状态标志 */
  execute(command: string, options?: { timeoutSec?: number }): Promise<SandboxResult>;
  /** 读取文件内容，支持可选的行范围（1-indexed，闭区间） */
  readFile(path: string, startLine?: number, endLine?: number): Promise<string>;
  /** 列出目录下的文件和目录（目录名带 / 后缀） */
  listFiles(path: string): Promise<string[]>;
  /** 销毁沙箱，释放资源（DockerSandbox 会停止并删除容器） */
  destroy(): Promise<void>;
}
