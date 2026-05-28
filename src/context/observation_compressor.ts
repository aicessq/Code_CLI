export class ObservationCompressor {
  private maxOutputChars: number;

  constructor(maxOutputChars = 20000) {
    this.maxOutputChars = maxOutputChars;
  }

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

  private compressBash(output: string): string {
    const lines = output.split("\n");

    // Check for pytest-style output
    if (output.includes("FAILED") || output.includes("PASSED") || output.includes("ERRORS")) {
      return this.compressPytest(lines);
    }

    // General bash: keep first 20 lines + last 20 lines + error lines
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

  private compressPytest(lines: string[]): string {
    const result: string[] = [];
    let inSummary = false;

    for (const line of lines) {
      // Keep FAILED lines
      if (line.includes("FAILED")) {
        result.push(line);
        continue;
      }

      // Keep short test summary section
      if (line.includes("short test summary") || line.includes("===")) {
        inSummary = true;
        result.push(line);
        continue;
      }

      // Keep assert lines
      if (line.trim().startsWith("assert") || line.trim().startsWith("AssertionError")) {
        result.push(line);
        continue;
      }

      // Keep traceback headers
      if (line.trim().startsWith("E ") || line.includes("Error") || line.includes("Exception")) {
        result.push(line);
        continue;
      }

      // Keep summary section lines
      if (inSummary && line.trim()) {
        result.push(line);
      }

      // Keep final result line
      if (line.includes("passed") || line.includes("failed") || line.includes("error")) {
        result.push(line);
      }
    }

    return result.join("\n").slice(0, this.maxOutputChars);
  }

  private compressGrep(output: string): string {
    const lines = output.split("\n");
    const maxMatches = 50;

    if (lines.length <= maxMatches) return output;

    const kept = lines.slice(0, maxMatches);
    const omitted = lines.length - maxMatches;

    return `${kept.join("\n")}\n[${omitted} more matches omitted]`.slice(0, this.maxOutputChars);
  }

  private compressFileRead(output: string): string {
    // Already bounded by line range, just truncate
    return this.truncate(output);
  }

  private truncate(output: string): string {
    if (output.length <= this.maxOutputChars) return output;

    const half = Math.floor(this.maxOutputChars / 2);
    const head = output.slice(0, half);
    const tail = output.slice(-half);

    return `${head}\n\n[... ${output.length - this.maxOutputChars} characters omitted ...]\n\n${tail}`;
  }
}
