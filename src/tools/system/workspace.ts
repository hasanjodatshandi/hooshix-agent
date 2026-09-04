import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";
import { auditToolCall } from "../../core/memory/tool-audit.js";
import { setActiveWorkspace, listWorkspaceRoots, getWorkspaceRoot } from "../../security/workspace-guard.js";

export function registerWorkspaceTools(server: McpServer): void {
  server.registerTool(
    "set_workspace",
    {
      title: "Set Workspace",
      description: "Set the active workspace directory. This changes where all file operations work.\n\nIMPORTANT: Use this tool at the start of a conversation to point to your project directory.\n\nExamples:\n  { \"tool\": \"set_workspace\", \"arguments\": { \"path\": \"D:/Projects/my-app\" } }\n  { \"tool\": \"set_workspace\", \"arguments\": { \"path\": \"C:/Users/me/code\" } }\n  { \"tool\": \"set_workspace\", \"arguments\": { \"path\": \"/home/user/projects\" } }\n\nSupports:\n  - Windows paths: D:/Projects/my-app\n  - Linux/Mac paths: /home/user/projects\n  - Relative paths: ../my-app\n  - Absolute paths for file tools (after setting workspace)\n\nReturns the resolved path and all configured workspace roots.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: z.object({
        path: z.string().min(1),
        correlationId: z.string().min(1).optional(),
      }),
    },
    async ({ path: targetPath, correlationId }) => {
      const traceId = resolveCorrelationId(correlationId);
      return auditToolCall("set_workspace", traceId, undefined, () => {
        const resolved = setActiveWorkspace(targetPath);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              workspace: resolved,
              previous: getWorkspaceRoot(),
              allRoots: listWorkspaceRoots(),
              message: `Workspace set to ${resolved}. All file operations will now work in this directory.`,
            }, null, 2),
          }],
          _meta: { correlationId: traceId },
        };
      });
    },
  );

  server.registerTool(
    "get_workspace",
    {
      title: "Get Workspace",
      description: "Get the current active workspace directory and all configured workspace roots.\n\nUse this to check which directory file operations will work in.\n\nExample: { \"tool\": \"get_workspace\", \"arguments\": {} }\n\nReturns:\n  - active: The current workspace directory\n  - roots: All allowed workspace directories",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      inputSchema: z.object({
        correlationId: z.string().min(1).optional(),
      }),
    },
    async ({ correlationId }) => {
      const traceId = resolveCorrelationId(correlationId);
      return auditToolCall("get_workspace", traceId, undefined, () => ({
        content: [{
          type: "text",
          text: JSON.stringify({
            active: getWorkspaceRoot(),
            roots: listWorkspaceRoots(),
            hint: "Use set_workspace to change the active directory. Absolute paths within any root are also allowed.",
          }, null, 2),
        }],
        _meta: { correlationId: traceId },
      }));
    },
  );
}
