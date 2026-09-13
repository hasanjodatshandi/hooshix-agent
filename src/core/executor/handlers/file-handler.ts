import { z } from "zod";
import path from "node:path";
import type { ToolHandler, ToolHandlerContext } from "./tool-handler.js";
import type { ToolName } from "../../orchestrator/tool-orchestrator.js";
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
function resolveTaskPath(filePath: string, executionContext?: { workspace: string }): string {
  if (path.isAbsolute(filePath)) return filePath;
  if (executionContext?.workspace) {
    return path.resolve(executionContext.workspace, filePath);
  }
  return filePath; // fallback to default behavior
}

export class FileToolHandler implements ToolHandler {
  canHandle(tool: ToolName): boolean {
    return FILE_TOOLS.has(tool);
  }

  async handle({ tool, input, correlationId, executionContext }: ToolHandlerContext): Promise<unknown> {
    const data = object.parse(input);
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
