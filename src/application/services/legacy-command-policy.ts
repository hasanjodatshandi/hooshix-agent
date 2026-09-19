export type CommandRisk = "low" | "medium" | "high";
export type PermissionDecision = "allow" | "approval_required" | "blocked";

const ALLOWED_COMMANDS = new Set(["node", "npm", "pnpm", "git", "python", "py", "gh"]);
const BLOCKED_PATTERNS: readonly RegExp[] = [
  /\b(format|shutdown|diskpart|cipher\s+\/w)\b/i,
  /\breg\s+delete\b/i,
  /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|--recursive\s+--force)\b/i,
  /\brm\s+-[a-z]*r\b/i,
  /\brm\s+-[a-z]*f\b/i,
  /\b(del|erase|rd|rmdir)\b[^|]*\/s\b/i,
  /\bremove-item\b[^|]*-recurse\b/i,
  /\bremove-item\b[^|]*-force\b/i,
  /\bformat-volume\b/i,
  /\bstop-computer\b|\brestart-computer\b/i,
  /\bclear-disk\b/i,
  /\bmkfs(\.\w+)?\b/i,
  /\bdd\s+if=/i,
  /\b(shred|sdelete)\b/i,
];
const SAFE_GIT_SUBCOMMANDS = new Set(["status", "diff", "log", "show", "branch", "rev-parse"]);
const SAFE_GH_PREFIXES = ["pr list", "pr view", "pr checks", "issue list", "issue view", "issue status", "repo view", "auth status", "config get", "config list"];

export function validateCommand(command: string, args: readonly string[] = []): true {
  if (!ALLOWED_COMMANDS.has(command.toLowerCase()) || command.includes("/") || command.includes("\\")) {
    throw new Error(`Command is not allowed: ${command}`);
  }
  if (args.some((argument) => argument.includes("\0") || argument.includes("\r") || argument.includes("\n"))) {
    throw new Error("Command arguments contain invalid control characters");
  }
  return true;
}

/**
 * Compatibility command policy. R2 will close HIGH-03 and replace this with
 * canonical path-aware command authorization. R1 deliberately preserves the
 * current decision table, including its known RED regression.
 */
export function evaluateCommandPermission(command: string, args: readonly string[] = []): { risk: CommandRisk; decision: PermissionDecision } {
  const rendered = [command, ...args].join(" ");
  for (const pattern of BLOCKED_PATTERNS) if (pattern.test(rendered)) return { risk: "high", decision: "blocked" };

  if (["node", "python", "py"].includes(command)) {
    if (args.length === 1 && ["--version", "-v"].includes(args[0])) return { risk: "low", decision: "allow" };
    return { risk: "high", decision: "approval_required" };
  }
  if (command === "npm" || command === "pnpm") {
    if (args[0] === "--version" || args[0] === "-v") return { risk: "low", decision: "allow" };
    return { risk: "high", decision: "approval_required" };
  }
  if (command === "gh") {
    const sub = args.join(" ").toLowerCase();
    if (SAFE_GH_PREFIXES.some((prefix) => sub === prefix || sub.startsWith(prefix + " "))) return { risk: "low", decision: "allow" };
    return { risk: "high", decision: "approval_required" };
  }
  if (command === "git" && SAFE_GIT_SUBCOMMANDS.has(args[0] ?? "")) return { risk: "low", decision: "allow" };
  if (command === "git" && args[0] === "--version") return { risk: "low", decision: "allow" };
  if (command === "git" && args[0] === "config" && ["--get", "--list", "-l"].includes(args[1] ?? "")) return { risk: "low", decision: "allow" };
  if (command === "powershell") return { risk: "high", decision: "approval_required" };
  return { risk: "medium", decision: "approval_required" };
}

export function assertCommandPermission(command: string, args: readonly string[] = []): true {
  const result = evaluateCommandPermission(command, args);
  if (result.decision === "blocked") throw new Error(`Command blocked: ${command}`);
  if (result.decision === "approval_required") throw new Error(`Approval required: ${command}`);
  return true;
}
