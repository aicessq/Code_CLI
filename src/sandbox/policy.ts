/**
 * 命令安全策略。
 *
 * 基于正则表达式的危险命令过滤器，作为沙箱的第一道防线。
 * 检测并阻止以下类型的危险操作：
 * - 文件系统破坏：rm -rf /、mkfs、dd 写设备
 * - 系统级操作：shutdown、reboot、halt
 * - 资源耗尽：fork bomb
 * - 远程代码执行：curl/wget 管道到 shell
 * - 权限提升：chmod 777 /
 *
 * 注意：这是简单的正则匹配，不能替代完整的沙箱隔离。
 * 对于绕过检测的恶意命令，需要依赖 DockerSandbox 的进程隔离。
 */
export class CommandPolicy {
  private blockedPatterns: Array<{ pattern: RegExp; reason: string }> = [
    { pattern: /rm\s+(-[a-z]*f[a-z]*\s+)?\/(\s|$)/, reason: "Blocked: rm on root filesystem" },
    { pattern: /rm\s+(-[a-z]*r[a-z]*f|f[a-z]*r)\s/, reason: "Blocked: rm -rf (dangerous recursive delete)" },
    { pattern: /:\(\)\s*\{\s*:\|\:\&\s*\}\s*;/, reason: "Blocked: fork bomb detected" },
    { pattern: /mkfs/, reason: "Blocked: filesystem destruction command" },
    { pattern: /dd\s+if=.*of=\/dev/, reason: "Blocked: dd writing to device" },
    { pattern: />\s*\/dev\/sd/, reason: "Blocked: writing to block device" },
    { pattern: /\bshutdown\b/, reason: "Blocked: shutdown command" },
    { pattern: /\breboot\b/, reason: "Blocked: reboot command" },
    { pattern: /\bhalt\b/, reason: "Blocked: halt command" },
    { pattern: /chmod\s+777\s+\//, reason: "Blocked: chmod 777 on root" },
    { pattern: /\bcurl\b.*\|\s*(bash|sh)/, reason: "Blocked: piped curl to shell" },
    { pattern: /\bwget\b.*\|\s*(bash|sh)/, reason: "Blocked: piped wget to shell" },
  ];

  /**
   * 检查命令是否被策略允许。
   * 按顺序匹配所有阻止模式，命中第一个即返回。
   */
  check(command: string): { allowed: boolean; reason?: string } {
    for (const { pattern, reason } of this.blockedPatterns) {
      if (pattern.test(command)) {
        return { allowed: false, reason };
      }
    }
    return { allowed: true };
  }
}
