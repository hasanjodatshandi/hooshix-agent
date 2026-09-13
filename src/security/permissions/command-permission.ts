import { validateCommand } from "../command-validator.js";

export type CommandRisk = "low" | "medium" | "high";
export type PermissionDecision = "allow" | "approval_required" | "blocked";

/**
 * Destructive pattern blocklist. Applied to the full rendered command.
 * Covers both Unix and Windows destructive forms; PowerShell scripting is
 * gated separately (powershell is approval-only by default).
 */
const BLOCKED_PATTERNS: RegExp[] = [
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

const safeGitSubcommands = new Set(["status", "diff", "log", "show", "branch", "rev-parse"]);
const safeGhPrefixes = ["pr list", "pr view", "pr checks", "issue list", "issue view", "issue status", "repo view", "auth status", "config get", "config list"];

export function evaluateCommandPermission(command: string, args: string[] = []): { risk: CommandRisk; decision: PermissionDecision } {
  const rendered = [command, ...args].join(" ");
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(rendered)) return { risk: "high", decision: "blocked" as const };
  }

  if (["node", "python", "py"].includes(command)) {
    if (args.length === 1 && ["--version", "-v"].includes(args[0])) return { risk: "low", decision: "allow" };
    // Interpreted languages execute arbitrary code — script files included.
    // `node -e`/`python -c` inline code and script files both require approval.
    return { risk: "high", decision: "approval_required" };
  }

  if (command === "npm" || command === "pnpm") {
    // `run`/`test` execute arbitrary package.json lifecycle scripts — approval.
    if (args[0] === "--version" || args[0] === "-v") return { risk: "low", decision: "allow" };
    return { risk: "high", decision: "approval_required" };
  }

  // GitHub CLI: read-only subcommands are safe; auth login mutates credentials
  // and everything else can change remote state — approval.
  if (command === "gh") {
    const ghSub = args.join(" ").toLowerCase();
    if (safeGhPrefixes.some((prefix) => ghSub === prefix || ghSub.startsWith(prefix + " "))) {
      return { risk: "low", decision: "allow" };
    }
    return { risk: "high", decision: "approval_required" };
  }

  if (command === "git" && safeGitSubcommands.has(args[0] ?? "")) return { risk: "low", decision: "allow" };
  if (command === "git" && args[0] === "--version") return { risk: "low", decision: "allow" };
  if (command === "git" && args[0] === "config" && ["--get", "--list", "-l"].includes(args[1] ?? "")) return { risk: "low", decision: "allow" };

  // PowerShell is an arbitrary-code interpreter: any use requires approval.
  // (Auto-prepending `-Command` happens in shell-service after this check.)
  if (command === "powershell") return { risk: "high", decision: "approval_required" };

  return { risk: "medium", decision: "approval_required" };
}

export function assertCommandPermission(command: string, args: string[] = []): true {
  const result = evaluateCommandPermission(command, args);
  if (result.decision === "blocked") throw new Error(`Command blocked: ${command}`);
  if (result.decision === "approval_required") throw new Error(`Approval required: ${command}`);
  return true;
}

// Re-export so callers validating commands get the canonical allowlist in one place.
export { validateCommand };
