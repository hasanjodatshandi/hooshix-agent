import type { TaskStep } from "../planner/task-planner.js";

export const TOOL_NAMES = [
  "get_system_info", "agent_metrics", "list_directory", "read_file", "write_file", "create_file",
  "modify_file", "delete_file", "restore_file", "search_files", "execute_command",
  "git_status", "git_diff", "git_clone", "git_commit", "git_branch", "git_checkout",
  "install_package", "remove_package", "update_package",
  "set_workspace", "get_workspace"
] as const;

export type ToolName = typeof TOOL_NAMES[number];
export type ToolRisk = "low" | "medium" | "high" | "critical";

export interface ToolCapability {
  risk: ToolRisk;
  capabilities: readonly string[];
  requiredArguments: readonly string[];
}

export const TOOL_CAPABILITIES: Record<ToolName, ToolCapability> = {
  get_system_info: { risk: "low", capabilities: ["system", "information", "inspect"], requiredArguments: [] },
  agent_metrics: { risk: "low", capabilities: ["metrics", "observability", "dashboard", "performance"], requiredArguments: [] },
  list_directory: { risk: "low", capabilities: ["list", "directory", "files", "inspect"], requiredArguments: [] },
  read_file: { risk: "low", capabilities: ["read", "inspect", "file", "project", "source"], requiredArguments: ["path"] },
  write_file: { risk: "medium", capabilities: ["implement", "write", "replace", "file", "changes"], requiredArguments: ["path", "content"] },
  create_file: { risk: "medium", capabilities: ["create", "new", "file"], requiredArguments: ["path", "content"] },
  modify_file: { risk: "medium", capabilities: ["modify", "edit", "replace", "file"], requiredArguments: ["path", "search", "replacement"] },
  delete_file: { risk: "high", capabilities: ["delete", "remove", "file"], requiredArguments: ["path"] },
  restore_file: { risk: "medium", capabilities: ["restore", "recover", "backup", "file"], requiredArguments: ["backupId"] },
  search_files: { risk: "low", capabilities: ["search", "find", "grep", "files"], requiredArguments: ["query"] },
  execute_command: { risk: "high", capabilities: ["execute", "run", "verify", "test", "build", "command"], requiredArguments: ["command"] },
  git_status: { risk: "low", capabilities: ["git", "status"], requiredArguments: [] },
  git_diff: { risk: "low", capabilities: ["git", "diff", "changes"], requiredArguments: [] },
  git_clone: { risk: "high", capabilities: ["git", "clone"], requiredArguments: ["url", "path"] },
  git_commit: { risk: "high", capabilities: ["git", "commit"], requiredArguments: ["message"] },
  git_branch: { risk: "high", capabilities: ["git", "branch"], requiredArguments: ["name"] },
  git_checkout: { risk: "high", capabilities: ["git", "checkout", "switch"], requiredArguments: ["name"] },
  install_package: { risk: "critical", capabilities: ["package", "install", "dependency"], requiredArguments: ["manager", "name"] },
  remove_package: { risk: "critical", capabilities: ["package", "remove", "uninstall", "dependency"], requiredArguments: ["manager", "name"] },
  update_package: { risk: "critical", capabilities: ["package", "update", "upgrade", "dependency"], requiredArguments: ["manager", "name"] },
  set_workspace: { risk: "medium", capabilities: ["workspace", "directory", "path", "config"], requiredArguments: ["path"] },
  get_workspace: { risk: "low", capabilities: ["workspace", "directory", "path", "info"], requiredArguments: [] }
};

const TOOL_SET = new Set<string>(TOOL_NAMES);
const RISK_RANK: Record<ToolRisk, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export function validateToolName(value: string): ToolName {
  if (!TOOL_SET.has(value)) throw new Error(`Unknown tool: ${value}`);
  return value as ToolName;
}

export function validateToolArguments(tool: ToolName, value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid arguments for ${tool}`);
  const input = value as Record<string, unknown>;
  const missing = TOOL_CAPABILITIES[tool].requiredArguments.filter((name) => !(name in input));
  if (missing.length > 0) throw new Error(`Invalid arguments for ${tool}: missing ${missing.join(", ")}`);
  return input;
}

function capabilityScore(action: string, capability: ToolCapability): number {
  const tokens = new Set(action.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean));
  return capability.capabilities.reduce((score, word, index) => score + (tokens.has(word) ? index === 0 ? 3 : 1 : 0), 0);
}

export class ToolSelector {
  select(step: TaskStep, available: readonly ToolName[] = TOOL_NAMES): ToolName {
    if (step.tool) return validateToolName(step.tool);
    if (available.length === 0) throw new Error("No tools are available");

    const ranked = available.map((tool) => ({ tool, score: capabilityScore(step.action, TOOL_CAPABILITIES[tool]) }))
      .sort((left, right) => right.score - left.score || RISK_RANK[TOOL_CAPABILITIES[left.tool].risk] - RISK_RANK[TOOL_CAPABILITIES[right.tool].risk] || TOOL_NAMES.indexOf(left.tool) - TOOL_NAMES.indexOf(right.tool));
    return ranked[0].score > 0 ? ranked[0].tool : "search_files";
  }
}

const defaultSelector = new ToolSelector();

export function selectTool(step: TaskStep): ToolName {
  return defaultSelector.select(step);
}

export async function executeToolStep(
  step: TaskStep,
  executor: (tool: ToolName, step: TaskStep) => Promise<unknown>
) {
  const tool = defaultSelector.select(step);

  const result = await executor(tool, step);

  return {
    tool,
    result
  };
}
