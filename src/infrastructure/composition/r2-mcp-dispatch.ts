import type { WorkspaceScope } from "../../domain/workspace/workspace-scope.js";
import type { ToolName } from "../../application/services/operation-catalog.js";
import type { TaskExecutionContext } from "../../application/dto/legacy-task-plan.js";
import { dispatchToHandler } from "../../core/executor/legacy-tool-handler-composition.js";
import { runWithWorkspaceScope } from "../../security/workspace-guard.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";
import { auditToolCall } from "../../core/memory/tool-audit.js";
import { getWorkspaceRoot, listWorkspaceRoots } from "../../security/workspace-guard.js";

const flatFile = new Set<ToolName>([
  "write_file","create_file","modify_file","delete_file","restore_file",
]);
const jsonResult=(value:unknown,trace:string)=>({
  content:[{type:"text" as const,text:JSON.stringify(value,null,2)}],
  _meta:{correlationId:trace},
});

/**
 * R2 sole live concrete tool dispatcher for inbound MCP. All schema-only
 * registrars are inert: this adapter is called ONLY from ExecuteToolUseCase's
 * authorized handler port. Task dispatch uses the same concrete dispatcher.
 */
export async function executeAuthorizedDirectTool(
  name:ToolName,
  args:Record<string,unknown>,
  scope:WorkspaceScope,
):Promise<unknown> {
  const trace=resolveCorrelationId(typeof args.correlationId==="string"?args.correlationId:undefined);
  const snapshot:TaskExecutionContext={
    workspace:scope.root,roots:[...scope.allowedRoots],
    allowedRootsSnapshot:[...scope.allowedRoots],unrestricted:scope.unrestricted,
    principalId:scope.principalId,sessionId:scope.sessionId,
    createdAt:scope.capturedAt,
  };
  return auditToolCall(name,trace,undefined,async()=>{
    const raw=await runWithWorkspaceScope(scope.root,()=>
      dispatchToHandler(name,args,trace,snapshot));
    if(name==="read_file") {
      // includeSha256 contract: the payload becomes { content, sha256 }.
      // Machine-readable fields must ride inside the content block: extra
      // top-level siblings are not part of the CallToolResult shape, so
      // strict clients silently dropped the hash and the safe
      // read-modify-write workflow (ifMatchSha256) could never obtain one.
      if(typeof raw==="string")
        return {content:[{type:"text" as const,text:raw}],_meta:{correlationId:trace}};
      const hashed=raw as {content:string;sha256:string};
      return {content:[{type:"text" as const,
        text:JSON.stringify({content:hashed.content,sha256:hashed.sha256},null,2)}],
        _meta:{correlationId:trace}};
    }
    if(name==="list_directory") {
      const entries=raw as string[];
      return {content:[{type:"text" as const,text:entries.join("\n")}],
        _meta:{correlationId:trace}};
    }
    if(name==="search_files") {
      const result=raw as {matches:unknown[]};
      return {content:[{type:"text" as const,text:result.matches.length
        ?JSON.stringify(result,null,2):"No matches found"}],
        _meta:{correlationId:trace}};
    }
    if(flatFile.has(name)) {
      const value=raw&&typeof raw==="object"?raw as Record<string,unknown>:{};
      const flat=name==="restore_file"
        ?{backupId:args.backupId,restored:true,path:value.path,
          displacedBackupId:value.displacedBackupId??null}
        :name==="delete_file"?{path:args.path,deleted:true,...value}
        :name==="create_file"?{path:args.path,created:true,...value}
        :{path:args.path,...value};
      return {...flat,content:[{type:"text" as const,text:JSON.stringify(flat)}],
        _meta:{correlationId:trace}};
    }
    if(name==="get_system_info"){
      const value=raw as Record<string,unknown>;
      return jsonResult({...value,memoryBytes:value.memory},trace);
    }
    if(name==="get_workspace"){
      const active=getWorkspaceRoot();
      const value={
        active,roots:listWorkspaceRoots(),
        security:{
          fileToolsScope:"active workspace only",
          subprocessScope:"active workspace; cwd outside requires approval",
          effectiveDescription:"File tools: active workspace only. Subprocesses: active workspace; cwd outside requires approval.",
        },
        hint:active===null
          ?"No active workspace — file tools are DENIED until you select a persisted root with set_workspace. Allowed roots survive service restarts."
          :"File tools touch the ACTIVE workspace only. Use add_workspace_roots to extend the persistent pool, set_workspace to select the active root, remove_workspace_root to drop one.",
      };
      return jsonResult(value,trace);
    }
    if(name==="set_workspace"){
      const value=raw as Record<string,unknown>;
      const flat={...value,allRoots:listWorkspaceRoots(),
        message:`Active workspace: ${value.workspace}. File tools are restricted to the active workspace. Other allowed roots are listed but not implicitly accessible.`};
      return jsonResult(flat,trace);
    }
    if(name==="git_branch"){
      return jsonResult({created:true,branch:args.name,checkedOut:false,
        ...(raw&&typeof raw==="object"?raw as Record<string,unknown>:{})},trace);
    }
    if(name==="git_checkout"){
      return jsonResult({branch:args.name,created:args.create??false,switched:true,
        ...(raw&&typeof raw==="object"?raw as Record<string,unknown>:{})},trace);
    }
    return jsonResult(raw,trace);
  });
}
