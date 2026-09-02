import type { TaskStep } from "../planner/task-planner.js";

export type ToolName =
  | "get_system_info"
  | "list_directory"
  | "read_file"
  | "write_file"
  | "create_file"
  | "modify_file"
  | "delete_file"
  | "restore_file"
  | "search_files"
  | "execute_command"
  | "git_status"
  | "git_diff"
  | "git_clone"
  | "git_commit"
  | "git_branch"
  | "git_checkout"
  | "install_package"
  | "remove_package"
  | "update_package";

export function selectTool(step: TaskStep): ToolName {
  if (step.tool) return step.tool;
  const action = step.action.toLowerCase();

  if (action.includes("inspect") || action.includes("read")) {
    return "read_file";
  }

  if (action.includes("implement") || action.includes("create")) {
    return "write_file";
  }

  if (action.includes("verify") || action.includes("test")) {
    return "execute_command";
  }

  return "search_files";
}

export async function executeToolStep(
  step: TaskStep,
  executor: (tool: ToolName, step: TaskStep) => Promise<unknown>
) {
  const tool = selectTool(step);

  const result = await executor(tool, step);

  return {
    tool,
    result
  };
}
