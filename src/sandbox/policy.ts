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

  check(command: string): { allowed: boolean; reason?: string } {
    for (const { pattern, reason } of this.blockedPatterns) {
      if (pattern.test(command)) {
        return { allowed: false, reason };
      }
    }
    return { allowed: true };
  }
}
