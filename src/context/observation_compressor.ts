/**
 * 工具输出智能压缩器。
 *
 * 根据工具类型采用不同的压缩策略，在保留关键信息的前提下减少 token 消耗。
 * 已构建但尚未集成到 agent loop 中（当前直接发送原始输出）。
 *
 * 压缩策略：
 * - bash: 保留前 20 行 + 后 20 行 + 所有错误行
 * - bash (pytest): 提取 FAILED 用例、断言错误、traceback 头和汇总行
 * - grep: 限制最多 50 条匹配
 * - read_file: 直接截断（已由行范围限制）
 * - 其他: 头尾各保留一半
 */
export class ObservationCompressor {
  private maxOutputChars: number;

  constructor(maxOutputChars = 20000) {
    this.maxOutputChars = maxOutputChars;
  }

  /**
   * 压缩工具输出。
   * 短于阈值的输出直接返回，超过阈值则按工具类型选择压缩策略。
   */
  compress(toolName: string, rawOutput: string): string {
    if (rawOutput.length <= this.maxOutputChars) return rawOutput;

    switch (toolName) {
      case "bash":
        return this.compressBash(rawOutput);
      case "grep":
        return this.compressGrep(rawOutput);
      case "read_file":
        return this.compressFileRead(rawOutput);
      default:
        return this.truncate(rawOutput);
    }
  }

  /**
   * bash 输出压缩。
   * 检测是否为 pytest 输出（包含 FAILED/PASSED/ERRORS），
   * 是则使用 pytest 专用压缩，否则保留头尾 + 错误行。
   */
  private compressBash(output: string): string {
    const lines = output.split("\n");

    // 检测 pytest 输出格式
    if (output.includes("FAILED") || output.includes("PASSED") || output.includes("ERRORS")) {
      return this.compressPytest(lines);
    }

    // 通用 bash：保留前 20 行 + 后 20 行 + 错误行
    const errorKeywords = /error|Error|ERR|fail|Fail|FAIL|exception|Exception|panic|PANIC/i;
    const errorLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      if (errorKeywords.test(lines[i])) {
        errorLines.push(`L${i + 1}: ${lines[i]}`);
      }
    }

    const head = lines.slice(0, 20).join("\n");
    const tail = lines.slice(-20).join("\n");

    let result = head;
    if (errorLines.length > 0) {
      result += `\n\n[Error lines]\n${errorLines.join("\n")}`;
    }
    if (lines.length > 40) {
      result += `\n\n[... ${lines.length - 40} lines omitted ...]\n${tail}`;
    }

    return result.slice(0, this.maxOutputChars);
  }

  /** pytest 输出压缩：保留 FAILED 用例、断言错误、traceback 和汇总 */
  private compressPytest(lines: string[]): string {
    const result: string[] = [];
    let inSummary = false;

    for (const line of lines) {
      if (line.includes("FAILED")) {
        result.push(line);
        continue;
      }

      if (line.includes("short test summary") || line.includes("===")) {
        inSummary = true;
        result.push(line);
        continue;
      }

      if (line.trim().startsWith("assert") || line.trim().startsWith("AssertionError")) {
        result.push(line);
        continue;
      }

      if (line.trim().startsWith("E ") || line.includes("Error") || line.includes("Exception")) {
        result.push(line);
        continue;
      }

      if (inSummary && line.trim()) {
        result.push(line);
      }

      if (line.includes("passed") || line.includes("failed") || line.includes("error")) {
        result.push(line);
      }
    }

    return result.join("\n").slice(0, this.maxOutputChars);
  }

  /** grep 输出压缩：限制最多 50 条匹配结果 */
  private compressGrep(output: string): string {
    const lines = output.split("\n");
    const maxMatches = 50;

    if (lines.length <= maxMatches) return output;

    const kept = lines.slice(0, maxMatches);
    const omitted = lines.length - maxMatches;

    return `${kept.join("\n")}\n[${omitted} more matches omitted]`.slice(0, this.maxOutputChars);
  }

  /** 文件读取压缩：已由行范围限制，直接截断 */
  private compressFileRead(output: string): string {
    return this.truncate(output);
  }

  /** 通用截断：保留头尾各一半 */
  private truncate(output: string): string {
    if (output.length <= this.maxOutputChars) return output;

    const half = Math.floor(this.maxOutputChars / 2);
    const head = output.slice(0, half);
    const tail = output.slice(-half);

    return `${head}\n\n[... ${output.length - this.maxOutputChars} characters omitted ...]\n\n${tail}`;
  }
}
