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
      description: "📂 WORKSPACE — Set the ACTIVE workspace for all file tools. This REPLACES the allowed roots with just this directory: the previous workspace becomes inaccessible to file tools (no permission accumulation).\n\nFile tools (read/write/delete/search) can only touch the active workspace. Paths outside are rejected.\n\nExamples: { \"path\": \"D:/Projects/my-app\" } · { \"path\": \"D:/Projects/my-app\", \"unrestricted\": true } — unrestricted grants file tools access to ANY system path and REQUIRES APPROVAL through an approved task step. Only for trusted local use.",
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
              fileToolsScope: isUnrestrictedMode() ? "any path on the system" : "active workspace only",
              subprocessScope: "active workspace; cwd outside requires approval",
              effectiveDescription: isUnrestrictedMode()
                ? "File tools: unrestricted (any path). Subprocesses: active workspace; cwd outside requires approval."
                : "File tools: active workspace only. Subprocesses: active workspace; cwd outside requires approval.",
            },
            hint: isUnrestrictedMode()
              ? "Unrestricted mode is ON. All file tools can access any absolute path on the system."
              : "Use set_workspace to switch (and REPLACE the allowed scope with) the active directory.",
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
      description: "📂 WORKSPACE — Remove a directory from the allowed roots list. The ACTIVE workspace cannot be removed (it is the only file-tool scope) — switch first with set_workspace.\n\nExample: { \"path\": \"D:/Projects/old-project\" }",
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
      description: "📂 WORKSPACE — Replace ALL workspace roots with a single new root (switch projects). Equivalent to set_workspace.\n\nExample: { \"path\": \"D:/Projects/new-project\" }",
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
