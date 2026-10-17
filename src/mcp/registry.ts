import path from "node:path";
import { z } from "zod";
import { createR2RuntimeGateway, requireSuccessfulGateway, enforcementJailRoot } from "../core/executor/r2-runtime-gateway.js";
import { getTrustedInboundIdentity } from "../core/runtime/r2-trusted-inbound-identity.js";
import type { ToolId } from "../domain/shared/ids.js";
import { TOOL_NAMES, type ToolName } from "../application/services/operation-catalog.js";
import { executeAuthorizedDirectTool } from "../infrastructure/composition/r2-mcp-dispatch.js";
import type { McpServer } from "../adapters/inbound/mcp/legacy-sdk-bridge.js";
import { captureToolRegistrar, installToolRegistrar } from "./tool-registrar.js";
import { listWorkspaceRoots, runWithWorkspaceScope, sameRootIdentity } from "../security/workspace-guard.js";
import { resolveProjectHandle } from "../security/project-handles.js";
import { saveDecisionWithContext } from "../core/memory/context-memory.js";
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
import { registerExecTool } from "../tools/shell/exec.js";
import { registerGitTools } from "../tools/git/index.js";
import { registerPackageTools } from "../tools/package/index.js";
import { registerTaskTools } from "../tools/task/index.js";
import { registerAgentMetricsTool } from "../tools/system/agent-metrics.js";
import { registerChatIsolationProbeTool } from "../tools/system/chat-isolation-probe.js";
import { registerHelpTool } from "../tools/system/help.js";
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
  const originalRegisterTool = captureToolRegistrar(server);

  installToolRegistrar(server, (name, config, ...rest) => {
    if (config?.title && (!config.annotations || config.annotations.title === undefined)) {
      config = { ...config, annotations: { ...config.annotations, title: config.title } };
    }
    return originalRegisterTool(name, config, ...rest);
  });
}

/**
 * CI-G6 — tools whose behavior resolves through the active workspace must carry
 * the conversation's project handle (`project` argument). The handle is minted
 * by open_project and lives only in the chat that opened it, so two
 * conversations on ONE connection cannot bleed a workspace into each other.
 * `exec` is deliberately absent: it is unrestricted by design and ignores the
 * workspace entirely.
 *
 * `task_create` is here because a plan is born with a workspace: it persists the
 * resolved root as its immutable execution context, and every later step —
 * including the workspace-bound tools above, which a plan can only reach
 * THROUGH that snapshot — is confined to it. Without the handle at creation the
 * plan captures no root and every step is then denied for
 * `workspace_missing_or_ungranted`, so the failure must surface here, where it
 * is still fixable. `task_run`/`task_append_steps` are deliberately NOT listed:
 * the plan's own captured root governs them, and asking for a handle that could
 * not change the outcome would only suggest that it could.
 */
const PROJECT_SCOPED_TOOLS: ReadonlySet<string> = new Set([
  "list_directory", "read_file", "write_file", "create_file", "modify_file",
  "delete_file", "restore_file", "search_files", "execute_command",
  "git_status", "git_diff", "git_clone", "git_commit", "git_branch",
  "git_checkout", "git_add", "git_init", "git_log",
  "install_package", "remove_package", "update_package",
  "task_snapshot", "task_rollback", "task_create",
]);

const PROJECT_ARGUMENT = z.string().min(1).optional().describe(
  "Conversation project handle (ph_...) returned by open_project. Pass the SAME handle on every file/exec/git call — and on task_create, whose plan keeps that project as its permanent workspace — in THIS conversation. Required whenever this server has more than one allowed project.",
);

function workspaceProjectNames(): string[] {
  return listWorkspaceRoots().filter((root) => root.exists).map((root) => path.basename(root.path));
}

function denyProjectHandle(reason: string): void {
  saveDecisionWithContext({ action: "project_handle_reject", reason });
}

/**
 * Complete mediation of every registered direct MCP operation, including Task,
 * project, memory and workspace controls. No legacy callback can execute
 * before the application gateway returns an authorized decision.
 */
function withR2Gateway(server: McpServer): void {
  const inner = captureToolRegistrar(server);
  installToolRegistrar(server, (name, config, ...rest) => {
    if (PROJECT_SCOPED_TOOLS.has(name) && config?.inputSchema && typeof config.inputSchema.extend === "function") {
      config = { ...config, inputSchema: config.inputSchema.extend({ project: PROJECT_ARGUMENT }) };
    }
    const callback=rest[0] as ((args:any,...extra:any[])=>unknown)|undefined;
    if(typeof callback!=="function") throw new Error("R2: missing MCP tool callback for "+name);
    return inner(name,config,async (args:any,...extra:[unknown,...unknown[]])=>{
      const {principal,sessionId}=getTrustedInboundIdentity();
      const rawArgs=(args&&typeof args==="object"&&!Array.isArray(args)?args:{}) as Record<string,unknown>;
      let project:string|undefined;
      let callArguments=rawArgs;
      if(Object.hasOwn(rawArgs,"project")){
        // The handle is transport framing for this dispatch, never a handler
        // argument: resolve it here and keep it out of validation, policy and
        // approval fingerprinting downstream.
        const {project:candidate,...restArgs}=rawArgs;
        callArguments=restArgs;
        if(typeof candidate==="string"&&candidate.length>0)project=candidate;
        else if(PROJECT_SCOPED_TOOLS.has(name))
          throw new Error("invalid_project_argument: project must be the ph_... handle string returned by open_project");
      }
      let scopedRoot:string|undefined;
      if(project!==undefined){
        const lookup=resolveProjectHandle(project,String(principal.id));
        if(!lookup.ok){
          denyProjectHandle("project_handle_"+lookup.error);
          throw new Error(lookup.error==="expired"
            ?"project_handle_expired: this project handle has expired — call open_project again and use the NEW handle."
            :"project_handle_unknown: unknown project handle — call open_project and pass its handle as project=<handle>.");
        }
        // An enforcement jail is the Context's own root: a handle may only
        // confirm it, never widen it. Fail explicitly instead of silently
        // executing inside the jail while a different project was requested.
        const jail=enforcementJailRoot();
        if(jail&&!sameRootIdentity(jail,lookup.record.root)){
          denyProjectHandle("project_conflicts_with_context_workspace");
          throw new Error("project_conflicts_with_context_workspace: this connection is confined to its Context workspace; a project handle cannot widen it.");
        }
        scopedRoot=lookup.record.root;
      }else if(PROJECT_SCOPED_TOOLS.has(name)&&!enforcementJailRoot()){
        // Multi-project servers are ambiguous by nature — an untargeted call
        // must never fall back to whatever another conversation selected.
        const names=workspaceProjectNames();
        if(names.length>=2){
          denyProjectHandle("project_required");
          throw new Error(`project_required: this server hosts ${names.length} projects (${names.join(", ")}). Call open_project, then pass project=<handle> on every file/exec/git call in THIS conversation.`);
        }
      }
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
      const invoke=()=>gateway.execute({
        principal,descriptorId:name as ToolId,arguments:callArguments,
        directContext:{sessionId},
      });
      const result=scopedRoot!==undefined
        ?await runWithWorkspaceScope(scopedRoot,invoke)
        :await invoke();
      return requireSuccessfulGateway(result);
    },...rest.slice(1));
  });
}
export function registerTools(server: McpServer){
  withAnnotationsTitle(server);
  withR2Gateway(server);
  registerSystemInfoTool(server);
  registerAgentMetricsTool(server);
  // CI-G7: the read-only isolation probe. It is always advertised because its
  // output is honest in every mode — UNBOUND simply means the credential has no
  // Context binding, which is exactly what an operator needs to see when the
  // flag is OFF. It discloses only pseudonyms of the caller's OWN identity, so
  // there is nothing to gate behind the flag.
  registerChatIsolationProbeTool(server);
  // The onboarding manual. Always advertised, always callable: an assistant
  // that has not granted a folder yet is precisely the one that needs to be
  // told the order things happen in.
  registerHelpTool(server);
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
  registerExecTool(server);
  registerGitTools(server);
  registerPackageTools(server);
  registerTaskTools(server);
}