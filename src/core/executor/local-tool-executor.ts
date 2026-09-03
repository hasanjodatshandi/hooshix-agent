import os from "node:os";
import { z } from "zod";
import type { TaskStep } from "../planner/task-planner.js";
import { validateToolName } from "../orchestrator/tool-orchestrator.js";
import { createWorkspaceFile, deleteWorkspaceFile, listWorkspaceDirectory, modifyWorkspaceFile, readWorkspaceFile, restoreWorkspaceFile, searchWorkspaceFiles, writeWorkspaceFile } from "../../services/filesystem/filesystem-service.js";
import { executeShellCommand } from "../../services/shell/shell-service.js";
import { gitBranch, gitCheckout, gitClone, gitCommit, gitDiff, gitStatus } from "../../services/git/git-service.js";
import { managePackage } from "../../services/package/package-service.js";
import { auditToolCall } from "../memory/tool-audit.js";
import { getAgentMetrics } from "../trace/metrics-service.js";

const object = z.record(z.string(), z.unknown());
const pathInput = object.and(z.object({ path: z.string() }));

export function createLocalToolExecutor(correlationId: string, taskId?: string) {
  return async (tool: string, step: TaskStep): Promise<unknown> => {
    const validatedTool = validateToolName(tool);
    const raw = step.arguments ?? {};
    const trace = correlationId;
    return auditToolCall(tool, trace, taskId, async () => {
    const input = object.parse(raw);
    switch (validatedTool) {
      case "get_system_info": return { platform: os.platform(), cpu: os.cpus()[0]?.model, memory: os.totalmem() };
      case "agent_metrics": return getAgentMetrics();
      case "read_file": { const value = pathInput.parse(input); return readWorkspaceFile(value.path, trace); }
      case "list_directory": { const value = z.object({ path: z.string().default(".") }).parse(input); return listWorkspaceDirectory(value.path, trace); }
      case "search_files": { const value = z.object({ path: z.string().default("."), query: z.string().min(1) }).parse(input); return searchWorkspaceFiles(value.path, value.query, trace); }
      case "create_file": { const value = z.object({ path: z.string(), content: z.string() }).parse(input); return createWorkspaceFile(value.path, value.content, trace); }
      case "write_file": { const value = z.object({ path: z.string(), content: z.string() }).parse(input); return writeWorkspaceFile(value.path, value.content, trace); }
      case "modify_file": { const value = z.object({ path: z.string(), search: z.string().min(1), replacement: z.string() }).parse(input); return modifyWorkspaceFile(value.path, value.search, value.replacement, trace); }
      case "delete_file": { const value = pathInput.parse(input); return deleteWorkspaceFile(value.path, trace); }
      case "restore_file": { const value = z.object({ backupId: z.string().uuid() }).parse(input); return restoreWorkspaceFile(value.backupId, trace); }
      case "execute_command": {
        const value = z.object({ command: z.string(), args: z.array(z.string()).default([]), cwd: z.string().default("."), timeout: z.number().int().min(100).max(120000).default(30000) }).parse(input);
        const result = await executeShellCommand(value.command, value.args, value.cwd, value.timeout, trace);
        if (result.exitCode !== 0) throw new Error(result.stderr || `${value.command} exited with code ${result.exitCode}`);
        return result;
      }
      case "git_status": { const value = z.object({ cwd: z.string().default(".") }).parse(input); return gitStatus(value.cwd, trace); }
      case "git_diff": { const value = z.object({ cwd: z.string().default("."), staged: z.boolean().default(false) }).parse(input); return gitDiff(value.cwd, value.staged, trace); }
      case "git_clone": { const value = z.object({ url: z.url(), path: z.string() }).parse(input); return gitClone(value.url, value.path, trace); }
      case "git_commit": { const value = z.object({ cwd: z.string().default("."), message: z.string().min(1).max(500) }).parse(input); return gitCommit(value.cwd, value.message, trace); }
      case "git_branch": { const value = z.object({ cwd: z.string().default("."), name: z.string() }).parse(input); return gitBranch(value.cwd, value.name, trace); }
      case "git_checkout": { const value = z.object({ cwd: z.string().default("."), name: z.string(), create: z.boolean().default(false) }).parse(input); return gitCheckout(value.cwd, value.name, value.create, trace); }
      case "install_package":
      case "remove_package":
      case "update_package": {
        const value = z.object({ manager: z.enum(["npm", "pnpm", "pip", "winget", "choco"]), name: z.string(), cwd: z.string().default("."), timeout: z.number().int().min(1000).max(600000).default(300000) }).parse(input);
        const action = tool === "install_package" ? "install" : tool === "remove_package" ? "remove" : "update";
        return managePackage({ ...value, action, correlationId: trace });
      }
      default: throw new Error(`Unsupported task tool: ${tool}`);
    }
    });
  };
}
