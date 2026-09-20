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
const SAFE_GIT_SUBCOMMANDS = new Set(["status", "diff", "log"]);
const EXACT_SAFE_GH_COMMANDS = new Set(["pr list", "pr view", "pr checks", "issue list", "issue view", "issue status", "repo view", "auth status", "config get", "config list"]);


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
 * R2.07 fail-closed generic command policy. Dedicated Git tools can offer
 * narrower validated read operations; unrecognized argv is NEVER auto-allowed.
 */
export function evaluateCommandPermission(command: string, args: readonly string[] = []): { risk: CommandRisk; decision: PermissionDecision } {
  const rendered = [command, ...args].join(" ");
  for (const pattern of BLOCKED_PATTERNS) if (pattern.test(rendered)) return { risk: "high", decision: "blocked" };

  if (["node", "python", "py"].includes(command)) {
    if (args.length === 1 && ["--version", "-v"].includes(args[0])) return { risk: "low", decision: "allow" };
    return { risk: "high", decision: "approval_required" };
  }
  if (command === "npm" || command === "pnpm") {
    if (args.length === 1 && ["--version", "-v"].includes(args[0])) return { risk: "low", decision: "allow" };
    return { risk: "high", decision: "approval_required" };
  }
  if (command === "gh") {
    const sub = args.join(" ").toLowerCase();
    const numericResourceView = args.length === 3 &&
      (args[0] === "pr" || args[0] === "issue") &&
      (args[1] === "view" || (args[0] === "pr" && args[1] === "checks")) &&
      /^[1-9][0-9]*$/.test(args[2]);
    if ((EXACT_SAFE_GH_COMMANDS.has(sub) && args.every(arg => !arg.startsWith("-") && !/[\\/]/.test(arg))) || numericResourceView)
      return { risk: "low", decision: "allow" };
    return { risk: "high", decision: "approval_required" };
  }
  if (command === "git" && args[0] === "diff" && args.some(arg => arg === "--no-index" || arg.startsWith("--no-index="))) return { risk: "high", decision: "blocked" };
  if (command === "git" && args.length === 1 && SAFE_GIT_SUBCOMMANDS.has(args[0])) return { risk: "low", decision: "allow" };
  if (command === "git" && args.length === 1 && args[0] === "--version") return { risk: "low", decision: "allow" };
  // git config, diff pathspecs, log/show revisions, -c/--git-dir and all
  // path-bearing/option-bearing generic Git forms require governed approval.
  if (command === "powershell") return { risk: "high", decision: "approval_required" };
  return { risk: "medium", decision: "approval_required" };
}

export function assertCommandPermission(command: string, args: readonly string[] = []): true {
  const result = evaluateCommandPermission(command, args);
  if (result.decision === "blocked") throw new Error(`Command blocked: ${command}`);
  if (result.decision === "approval_required") throw new Error(`Approval required: ${command}`);
  return true;
}