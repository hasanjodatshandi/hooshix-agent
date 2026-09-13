import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSystemInfoTool } from "../tools/system/system-info.js";
import {
  registerReadFileTool,
  registerWriteFileTool,
  registerListDirectoryTool,
  registerModifyFileTool,
  registerSearchFilesTool,
  registerCreateFileTool,
  registerDeleteFileTool,
  registerRestoreFileTool
} from "../tools/filesystem/index.js";
import { registerExecuteCommandTool } from "../tools/shell/execute-command.js";
import { registerGitTools } from "../tools/git/index.js";
import { registerPackageTools } from "../tools/package/index.js";
import { registerTaskTools } from "../tools/task/index.js";
import { registerAgentMetricsTool } from "../tools/system/agent-metrics.js";
import { registerWorkspaceTools } from "../tools/system/workspace.js";

/**
 * ChatGPT (and other MCP clients) render `annotations.title` as the action
 * heading; a missing annotations.title falls back to the raw tool name.
 * HooshiX passes the human title as the top-level `title` field, so mirror it
 * into `annotations.title` (unless an explicit one is already present) — same
 * pattern Desktop Commander uses. Registration order guarantees every tool's
 * config passes through here exactly once.
 */
function withAnnotationsTitle(server: McpServer): void {
  const originalRegisterTool = server.registerTool.bind(server) as (
    name: string,
    config: any,
    ...rest: any[]
  ) => any;

  (server as any).registerTool = function (
    name: string,
    config: any,
    ...rest: any[]
  ) {
    if (config?.title && (!config.annotations || config.annotations.title === undefined)) {
      config = { ...config, annotations: { ...config.annotations, title: config.title } };
    }
    return originalRegisterTool(name, config, ...rest);
  };
}

export function registerTools(server: McpServer){
  withAnnotationsTitle(server);
  registerSystemInfoTool(server);
  registerAgentMetricsTool(server);
  registerWorkspaceTools(server);

  registerReadFileTool(server);
  registerWriteFileTool(server);
  registerListDirectoryTool(server);
  registerModifyFileTool(server);
  registerSearchFilesTool(server);
  registerCreateFileTool(server);
  registerDeleteFileTool(server);
  registerRestoreFileTool(server);

  registerExecuteCommandTool(server);
  registerGitTools(server);
  registerPackageTools(server);
  registerTaskTools(server);
}
