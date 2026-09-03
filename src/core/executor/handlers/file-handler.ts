import { z } from "zod";
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
const pathInput = object.and(z.object({ path: z.string() }));

export class FileToolHandler implements ToolHandler {
  canHandle(tool: ToolName): boolean {
    return FILE_TOOLS.has(tool);
  }

  async handle({ tool, input, correlationId }: ToolHandlerContext): Promise<unknown> {
    const data = object.parse(input);
    switch (tool) {
      case "read_file": {
        const value = pathInput.parse(data);
        return readWorkspaceFile(value.path, correlationId);
      }
      case "list_directory": {
        const value = z.object({ path: z.string().default(".") }).parse(data);
        return listWorkspaceDirectory(value.path, correlationId);
      }
      case "search_files": {
        const value = z.object({ path: z.string().default("."), query: z.string().min(1) }).parse(data);
        return searchWorkspaceFiles(value.path, value.query, correlationId);
      }
      case "create_file": {
        const value = z.object({ path: z.string(), content: z.string() }).parse(data);
        return createWorkspaceFile(value.path, value.content, correlationId);
      }
      case "write_file": {
        const value = z.object({ path: z.string(), content: z.string() }).parse(data);
        return writeWorkspaceFile(value.path, value.content, correlationId);
      }
      case "modify_file": {
        const value = z.object({ path: z.string(), search: z.string().min(1), replacement: z.string() }).parse(data);
        return modifyWorkspaceFile(value.path, value.search, value.replacement, correlationId);
      }
      case "delete_file": {
        const value = pathInput.parse(data);
        return deleteWorkspaceFile(value.path, correlationId);
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
