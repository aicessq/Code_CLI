export interface SandboxResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
}

export interface Sandbox {
  execute(command: string, options?: { timeoutSec?: number }): Promise<SandboxResult>;
  readFile(path: string, startLine?: number, endLine?: number): Promise<string>;
  listFiles(path: string): Promise<string[]>;
  destroy(): Promise<void>;
}
