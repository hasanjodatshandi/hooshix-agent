import { createR2RuntimeGateway, requireSuccessfulGateway } from "../infrastructure/composition/r2-runtime-gateway.js";
import { getTrustedInboundIdentity } from "../infrastructure/composition/r2-trusted-inbound-identity.js";
import type { ToolId } from "../domain/shared/ids.js";
import { TOOL_NAMES, type ToolName } from "../application/services/operation-catalog.js";
import { executeAuthorizedDirectTool } from "../infrastructure/composition/r2-mcp-dispatch.js";
import type { McpServer } from "../adapters/inbound/mcp/legacy-sdk-bridge.js";
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

/**
 * Complete mediation of every registered direct MCP operation, including Task,
 * project, memory and workspace controls. No legacy callback can execute
 * before the application gateway returns an authorized decision.
 */
function withR2Gateway(server: McpServer): void {
  const inner = server.registerTool.bind(server) as (name:string,config:any,...rest:any[])=>any;
  (server as any).registerTool = function(name:string,config:any,...rest:any[]) {
    const callback=rest[0] as ((args:any,...extra:any[])=>unknown)|undefined;
    if(typeof callback!=="function") throw new Error("R2: missing MCP tool callback for "+name);
    return inner(name,config,async (args:any,...extra:any[])=>{
      const {principal,sessionId}=getTrustedInboundIdentity();
      const isExecutable=(TOOL_NAMES as readonly string[]).includes(name);
      const gateway=createR2RuntimeGateway({
        async execute(id,validated,scope) {
          // The legacy registrar callback supplies only schema/metadata.
          // Actual filesystem, shell, Git, package and system effects now
          // dispatch exclusively from the authorized infrastructure port.
          if(isExecutable)
            return executeAuthorizedDirectTool(id as ToolName,validated as Record<string,unknown>,scope);
          return callback(validated,...extra);
        },
      });
      return requireSuccessfulGateway(await gateway.execute({
        principal,descriptorId:name as ToolId,arguments:args,
        directContext:{sessionId},
      }));
    },...rest.slice(1));
  };
}
export function registerTools(server: McpServer){
  withAnnotationsTitle(server);
  withR2Gateway(server);
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