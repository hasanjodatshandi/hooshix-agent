import { z } from "zod";
import path from "node:path";
import {isWSLWorkspaceURI} from "../../../security/wsl-workspace-uri.js";
import {getActiveWorkspace} from "../../../security/workspace-guard.js";
import {invokeWSLFileOperation} from "../../../security/wsl-workspace-client.js";
import {mutateWSLFile} from "../../../security/wsl-mutation-service.js";
import { policyDecisionPoint } from "../../governance/policy-decision-point.js";
import type { ToolHandler, ToolHandlerContext } from "./tool-handler.js";
import type { ToolName } from "../../../application/services/legacy-tool-orchestrator.js";
import {
  readWorkspaceFile,
  writeWorkspaceFile,
  createWorkspaceFile,
  modifyWorkspaceFile,
  deleteWorkspaceFile,
  restoreWorkspaceFile,
  listWorkspaceDirectory,
  searchWorkspaceFiles
} from "../../../services/filesystem/filesystem-service.js";

const FILE_TOOLS: ReadonlySet<ToolName> = new Set([
  "read_file", "write_file", "create_file", "modify_file",
  "delete_file", "restore_file", "list_directory", "search_files"
]);

const object = z.record(z.string(), z.unknown());

/**
 * Resolve a file path against the task's execution context.
 * If the path is relative and executionContext is available,
 * resolve against the task's persisted workspace (not the global workspace).
 */
function resolveTaskPath(filePath: string, executionContext?: { workspace: string | null }): string {
  if (path.isAbsolute(filePath)) return filePath;
  if (executionContext?.workspace) {
    return path.resolve(executionContext.workspace, filePath);
  }
  // No task workspace (empty-by-default pool) — leave relative; validateWorkspace
  // will deny it because no active workspace exists to resolve against.
  return filePath;
}

export class FileToolHandler implements ToolHandler {
  canHandle(tool: ToolName): boolean {
    return FILE_TOOLS.has(tool);
  }

  async handle({ tool, input, correlationId, executionContext }: ToolHandlerContext): Promise<unknown> {
    const data = object.parse(input);
    const root=executionContext?.workspace ?? getActiveWorkspace();
    if(root && isWSLWorkspaceURI(root)){
      // The owner-session broker is the only access path for Linux files.
      // Preserve the same PDP tool authorization as native Windows file IO.
      policyDecisionPoint.assertAllowed({tool,arguments:input,correlationId});
      // Mutations fail closed until secure remote backup/idempotency exists.
      if(tool==="read_file"){
        const value=z.object({path:z.string(),includeSha256:z.boolean().optional()}).parse(data);
        const result=await invokeWSLFileOperation(root,"read",value.path,{includeSHA256:value.includeSha256});
        return value.includeSha256?{content:result.content??"",sha256:result.sha256??""}:result.content??"";
      }
      if(tool==="list_directory"){
        const value=z.object({path:z.string().default(".")}).parse(data);
        const result=await invokeWSLFileOperation(root,"list",value.path);
        return (result.detailedEntries??[]).map(entry=>`${entry.type==="directory"?"[DIR]":"[FILE]"} ${entry.name}`);
      }
      if(tool==="search_files"){
        const value=z.object({path:z.string().default("."),query:z.string().min(1)}).parse(data);
        const result=await invokeWSLFileOperation(root,"search",value.path,{query:value.query});
        return {query:value.query,root:root+"/"+value.path,matches:result.matches??[],totalMatches:result.matches?.length??0,truncated:result.truncated??false};
      }
      if(tool==="create_file"||tool==="write_file"||tool==="modify_file"||
         tool==="delete_file"||tool==="restore_file")
        return mutateWSLFile(root,tool,data,correlationId);
      throw new Error("wsl_workspace_file_tool_not_supported");
    }
    switch (tool) {
      case "read_file": {
        const value = z.object({ path: z.string(), includeSha256: z.boolean().optional() }).parse(data);
        return readWorkspaceFile(resolveTaskPath(value.path, executionContext), correlationId, { includeSha256: value.includeSha256 });
      }
      case "list_directory": {
        const value = z.object({ path: z.string().default(".") }).parse(data);
        return listWorkspaceDirectory(resolveTaskPath(value.path, executionContext), correlationId);
      }
      case "search_files": {
        const value = z.object({ path: z.string().default("."), query: z.string().min(1) }).parse(data);
        return searchWorkspaceFiles(resolveTaskPath(value.path, executionContext), value.query, correlationId);
      }
      case "create_file": {
        const value = z.object({ path: z.string(), content: z.string() }).parse(data);
        return createWorkspaceFile(resolveTaskPath(value.path, executionContext), value.content, correlationId);
      }
      case "write_file": {
        const value = z.object({ path: z.string(), content: z.string(), ifMatchSha256: z.string().optional(), idempotencyKey: z.string().optional() }).parse(data);
        return writeWorkspaceFile(resolveTaskPath(value.path, executionContext), value.content, correlationId, { ifMatchSha256: value.ifMatchSha256, idempotencyKey: value.idempotencyKey });
      }
      case "modify_file": {
        const value = z.object({ path: z.string(), search: z.string().min(1), replacement: z.string(), ifMatchSha256: z.string().optional() }).parse(data);
        return modifyWorkspaceFile(resolveTaskPath(value.path, executionContext), value.search, value.replacement, correlationId, { ifMatchSha256: value.ifMatchSha256 });
      }
      case "delete_file": {
        const value = z.object({ path: z.string(), idempotencyKey: z.string().optional() }).parse(data);
        return deleteWorkspaceFile(resolveTaskPath(value.path, executionContext), correlationId, { idempotencyKey: value.idempotencyKey });
      }
      case "restore_file": {
        const value = z.object({ backupId: z.string().uuid() }).parse(data);
        return restoreWorkspaceFile(value.backupId, correlationId);
      }
      default:
        throw new Error(`FileToolHandler: unsupported tool ${tool}`);
    }
  }
}
