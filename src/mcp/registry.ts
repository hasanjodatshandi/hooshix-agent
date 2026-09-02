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

export function registerTools(server: McpServer){
  registerSystemInfoTool(server);

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
