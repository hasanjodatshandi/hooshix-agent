import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";
import { auditToolCall } from "../../core/memory/tool-audit.js";
import { setActiveWorkspace, listWorkspaceRoots, getWorkspaceRoot, removeWorkspaceRoot, addWorkspaceRoots } from "../../security/workspace-guard.js";

export function registerWorkspaceTools(server: McpServer): void {
  server.registerTool(
    "set_workspace",
    {
      title: "Set Workspace",
      description: "📂 WORKSPACE — Select the ACTIVE workspace from the allowed roots pool. Does NOT add or remove roots — the path must already be allowed (add it with add_workspace_roots first). File tools operate in the active workspace only — this tool cannot and will never expand that scope.\n\nExample: { \"path\": \"D:/Projects/my-app\" }",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: z.strictObject({
        path: z.string().min(1),
        correlationId: z.string().min(1).optional(),
      }),
    },
    async ({ path: targetPath, correlationId }) => {
      const traceId = resolveCorrelationId(correlationId);
      return auditToolCall("set_workspace", traceId, undefined, () => {
        const { resolved, previous } = setActiveWorkspace(targetPath);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              workspace: resolved,
              previous: previous ?? null,
              allRoots: listWorkspaceRoots(),
              fileToolsScope: "active workspace only",
              message: `Active workspace: ${resolved}. File tools are restricted to the active workspace. Other allowed roots are listed but not implicitly accessible.`,
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
      description: "📂 WORKSPACE — Show the active workspace and all allowed roots.\n\nExample: {}",
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
            security: {
              fileToolsScope: "active workspace only",
              subprocessScope: "active workspace; cwd outside requires approval",
              effectiveDescription: "File tools: active workspace only. Subprocesses: active workspace; cwd outside requires approval.",
            },
            hint: getWorkspaceRoot() === null
              ? "No active workspace — file tools are DENIED until you add a root with add_workspace_roots and select it with set_workspace. The pool starts empty by design."
              : "File tools touch the ACTIVE workspace only. Use add_workspace_roots to extend the allowed pool, set_workspace to select the active root, remove_workspace_root to drop one.",
          }, null, 2),
        }],
        _meta: { correlationId: traceId },
      }));
    },
  );

  server.registerTool(
    "add_workspace_roots",
    {
      title: "Add Workspace Roots",
      description: "📂 WORKSPACE — Add one or more directories to the allowed workspace roots pool (idempotent). Roots must exist on disk. The pool starts EMPTY — this is how it gets its first roots; the first root ever added also becomes the active workspace. Does NOT switch the active workspace — use set_workspace for that.\n\nExample: { \"paths\": [\"D:/Projects/app-a\", \"D:/Projects/app-b\"] }",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: z.object({
        paths: z.array(z.string().min(1)).min(1).max(50).describe("Absolute directory paths to allow."),
        correlationId: z.string().min(1).optional(),
      }),
    },
    async ({ paths, correlationId }) => {
      const traceId = resolveCorrelationId(correlationId);
      return auditToolCall("add_workspace_roots", traceId, undefined, () => {
        const results = addWorkspaceRoots(paths);
        const active = getWorkspaceRoot();
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              results,
              active,
              firstRootBecameActive: active !== null && results.some((r) => r.added),
              roots: listWorkspaceRoots(),
            }, null, 2),
          }],
          _meta: { correlationId: traceId },
        };
      });
    },
  );

  server.registerTool(
    "remove_workspace_root",
    {
      title: "Remove Workspace Root",
      description: "📂 WORKSPACE — Remove a directory from the allowed roots pool. The ACTIVE workspace cannot be removed (file tools operate there) — select another allowed root with set_workspace first.\n\nExample: { \"path\": \"D:/Projects/old-project\" }",
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
            text: JSON.stringify({ removed, path: targetPath, active: getWorkspaceRoot(), roots: listWorkspaceRoots() }, null, 2),
          }],
          _meta: { correlationId: traceId },
        };
      });
    },
  );
}
