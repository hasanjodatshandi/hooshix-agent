export type PermissionLevel = "READ_ONLY" | "PROJECT_ACCESS" | "DEVELOPER_MODE" | "ADMIN_MODE";

const rank: Record<PermissionLevel, number> = {
  READ_ONLY: 0,
  PROJECT_ACCESS: 1,
  DEVELOPER_MODE: 2,
  ADMIN_MODE: 3
};

const requiredLevel: Record<string, PermissionLevel> = {
  read_file: "READ_ONLY",
  list_directory: "READ_ONLY",
  search_files: "READ_ONLY",
  get_system_info: "READ_ONLY",
  agent_metrics: "READ_ONLY",
  git_status: "READ_ONLY",
  git_diff: "READ_ONLY",
  task_get: "READ_ONLY",
  task_list: "READ_ONLY",
  task_report: "READ_ONLY",
  task_replay: "DEVELOPER_MODE",
  task_cancel: "PROJECT_ACCESS",
  project_list: "READ_ONLY",
  memory_list: "READ_ONLY",
  write_file: "PROJECT_ACCESS",
  create_file: "PROJECT_ACCESS",
  modify_file: "PROJECT_ACCESS",
  delete_file: "PROJECT_ACCESS",
  restore_file: "PROJECT_ACCESS",
  task_create: "PROJECT_ACCESS",
  project_save: "PROJECT_ACCESS",
  memory_add: "PROJECT_ACCESS",
  execute_command: "DEVELOPER_MODE",
  git_clone: "DEVELOPER_MODE",
  git_commit: "DEVELOPER_MODE",
  git_branch: "DEVELOPER_MODE",
  git_checkout: "DEVELOPER_MODE",
  package_manage: "DEVELOPER_MODE",
  task_run: "DEVELOPER_MODE",
  task_resume: "DEVELOPER_MODE",
  task_approve: "DEVELOPER_MODE"
};

export function getPermissionLevel(): PermissionLevel {
  const configured = process.env.HOOSHIX_PERMISSION_LEVEL ?? "DEVELOPER_MODE";
  if (!(configured in rank)) throw new Error(`Invalid HOOSHIX_PERMISSION_LEVEL: ${configured}`);
  return configured as PermissionLevel;
}

export function assertToolPermission(tool: string, level = getPermissionLevel()): true {
  const required = requiredLevel[tool] ?? "ADMIN_MODE";
  if (rank[level] < rank[required]) throw new Error(`${tool} requires ${required}; current level is ${level}`);
  return true;
}

export function assertAdminPermission(level = getPermissionLevel()): true {
  if (rank[level] < rank.ADMIN_MODE) throw new Error(`Operation requires ADMIN_MODE; current level is ${level}`);
  return true;
}
