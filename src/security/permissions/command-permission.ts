export type CommandRisk = "low" | "medium" | "high";
export type PermissionDecision = "allow" | "approval_required" | "blocked";

const blocked = /\b(format|shutdown|diskpart|reg\s+delete)\b|rm\s+-rf|del\s+\/s/i;
const safeGitSubcommands = new Set(["status", "diff", "log", "show", "branch", "rev-parse"]);

export function evaluateCommandPermission(command: string, args: string[] = []): { risk: CommandRisk; decision: PermissionDecision } {
  const rendered = [command, ...args].join(" ");
  if (blocked.test(rendered)) return { risk: "high", decision: "blocked" };

  if (["node", "python", "py"].includes(command)) {
    if (args.length === 1 && ["--version", "-v"].includes(args[0])) return { risk: "low", decision: "allow" };
    if (args.length > 0 && !args[0].startsWith("-")) return { risk: "medium", decision: "allow" };
    return { risk: "medium", decision: "approval_required" };
  }

  if (command === "npm" || command === "pnpm") {
    if (["test", "run", "--version", "-v"].includes(args[0] ?? "")) return { risk: "medium", decision: "allow" };
    return { risk: "medium", decision: "approval_required" };
  }

  if (command === "git" && safeGitSubcommands.has(args[0] ?? "")) return { risk: "low", decision: "allow" };
  if (command === "powershell" && args[0]?.toLowerCase() === "-file" && args[1] && !args[1].startsWith("-")) return { risk: "medium", decision: "allow" };
  return { risk: "medium", decision: "approval_required" };
}

export function assertCommandPermission(command: string, args: string[] = []): true {
  const result = evaluateCommandPermission(command, args);
  if (result.decision === "blocked") throw new Error(`Command blocked: ${command}`);
  if (result.decision === "approval_required") throw new Error(`Approval required: ${command}`);
  return true;
}
