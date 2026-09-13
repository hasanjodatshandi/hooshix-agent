import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";
import { auditToolCall } from "../../core/memory/tool-audit.js";
import { setActiveWorkspace, listWorkspaceRoots, getWorkspaceRoot, setUnrestrictedMode, isUnrestrictedMode, removeWorkspaceRoot, replaceWorkspaceRoots } from "../../security/workspace-guard.js";

export function registerWorkspaceTools(server: McpServer): void {
  server.registerTool(
    "set_workspace",
    {
      title: "Set Workspace",
      description: "📂 WORKSPACE — Set the active workspace directory for all file tools.\n\nFile tools are restricted to workspace roots (HOOSHIX_WORKSPACE env or this tool). Paths outside roots are rejected.\n\nExamples: { \"path\": \"D:/Projects/my-app\" } · { \"path\": \"D:/Projects/my-app\", \"unrestricted\": true } — unrestricted grants file tools access to ANY system path and REQUIRES APPROVAL through an approved task step. Only for trusted local use.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: z.object({
        path: z.string().min(1),
        unrestricted: z.boolean().optional().describe("Explicitly enable unrestricted mode (any absolute path on the system). Default: false — file tools stay restricted to workspace roots."),
        correlationId: z.string().min(1).optional(),
      }),
    },
    async ({ path: targetPath, unrestricted, correlationId }) => {
      const traceId = resolveCorrelationId(correlationId);
      return auditToolCall("set_workspace", traceId, undefined, () => {
        const { resolved, previous } = setActiveWorkspace(targetPath);
        if (unrestricted !== undefined) {
          setUnrestrictedMode(unrestricted);
        }
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              workspace: resolved,
              previous: previous ?? null,
              allRoots: listWorkspaceRoots(),
              unrestricted: isUnrestrictedMode(),
              message: isUnrestrictedMode()
                ? `Workspace set to ${resolved}. Unrestricted mode ON — all file tools can access any path on the system.`
                : `Workspace set to ${resolved}. File tools are restricted to workspace roots.`,
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
      description: "📂 WORKSPACE — Show active workspace directory + all configured roots + unrestricted mode status.\n\nExample: {}",
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
            unrestricted: isUnrestrictedMode(),
            security: {
              fileToolsRestricted: !isUnrestrictedMode(),
              subprocessSandboxed: false,
              effectiveDescription: isUnrestrictedMode()
                ? "File tools: unrestricted (any path). Subprocesses: unsandboxed."
                : "File tools: restricted to workspace roots. Subprocesses: unsandboxed (execute_command has no sandbox).",
            },
            hint: isUnrestrictedMode()
              ? "Unrestricted mode is ON. All file tools can access any absolute path on the system."
              : "Use set_workspace to change the active directory and enable unrestricted mode.",
          }, null, 2),
        }],
        _meta: { correlationId: traceId },
      }));
    },
  );

  server.registerTool(
    "remove_workspace_root",
    {
      title: "Remove Workspace Root",
      description: "📂 WORKSPACE — Remove one directory from the allowed workspace roots list.\n\nExample: { \"path\": \"D:/Projects/old-project\" }",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: z.object({
        path: z.string().min(1),
        correlationId: z.string().min(1).optional(),
      }),
    },
    async ({ path: targetPath, correlationId }) => {
      const traceId = resolveCorrelationId(correlationId);
      return auditToolCall("remove_workspace_root", traceId, undefined, () => {
        const removed = removeWorkspaceRoot(targetPath);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ removed, path: targetPath, roots: listWorkspaceRoots() }, null, 2),
          }],
          _meta: { correlationId: traceId },
        };
      });
    },
  );

  server.registerTool(
    "replace_workspace_roots",
    {
      title: "Replace Workspace Roots",
      description: "📂 WORKSPACE — Replace ALL workspace roots with a single new root (switch projects).\n\nExample: { \"path\": \"D:/Projects/new-project\" }",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: z.object({
        path: z.string().min(1),
        correlationId: z.string().min(1).optional(),
      }),
    },
    async ({ path: targetPath, correlationId }) => {
      const traceId = resolveCorrelationId(correlationId);
      return auditToolCall("replace_workspace_roots", traceId, undefined, () => {
        const roots = replaceWorkspaceRoots(targetPath);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ workspace: getWorkspaceRoot(), roots, unrestricted: isUnrestrictedMode() }, null, 2),
          }],
          _meta: { correlationId: traceId },
        };
      });
    },
  );
}
