import { z } from "zod";
import type { McpServer } from "../../adapters/inbound/mcp/legacy-sdk-bridge.js";
import { auditToolCall } from "../../core/memory/tool-audit.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";
import { getTrustedInboundIdentity } from "../../core/runtime/r2-trusted-inbound-identity.js";
import { saveDecisionWithContext } from "../../core/memory/context-memory.js";
import { assertToolPermission } from "../../security/permission.js";
import { closeProjectHandle, mintProjectHandle, resolveProjectSelector } from "../../security/project-handles.js";
// Project Git diagnostics are provided by the composition root; this inbound
// registrar must not import concrete Git/process services directly.

function response(value: unknown, correlationId: string) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], _meta: { correlationId } };
}

/** Schema-only registrations. Workspace state changes occur behind R2 gateway. */
export function registerWorkspaceTools(
  server: McpServer,
  inspectGitReadiness: (root: string) => Promise<{ status: string; advice?: string }>,
): void {
  server.registerTool(
    "set_workspace",
    {
      title: "Set Workspace",
      description: "📂 WORKSPACE — Select the ACTIVE workspace from the allowed roots pool. Does NOT add or remove roots — the path must already be allowed (add it with add_workspace_roots first). On a single-project server this sets the file-tool scope to the active workspace. On a multi-project server (2+ allowed roots) an active workspace alone does NOT authorize file/exec/git calls — those must carry project=<handle> returned by open_project (this tool also returns a handle you can use). A workspace root can never be widened by set_workspace.\n\nExample: { \"path\": \"D:/Projects/my-app\" }",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: z.strictObject({
        path: z.string().min(1),
        correlationId: z.string().min(1).optional(),
      }),
    },
    async () => { throw new Error("r2_legacy_direct_callback_retired"); },
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
    async () => { throw new Error("r2_legacy_direct_callback_retired"); },
  );
  server.registerTool(
    "add_workspace_roots",
    {
      title: "Add Workspace Roots",
      description: "📂 WORKSPACE — Add one or more existing local Windows directories to the persistent allowed workspace roots pool (idempotent). This is a governed change: create a Task with add_workspace_roots, run it, approve, and resume. Network shares and WSL roots are not authorized workspace roots. Does NOT switch the active workspace. Example: { \"paths\": [\"D:/Projects/app-a\"] }",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: z.object({
        paths: z.array(z.string().min(1)).min(1).max(50).describe("Existing local Windows workspace directories."),
        correlationId: z.string().min(1).optional(),
      }),
    },
    async () => { throw new Error("r2_legacy_direct_callback_retired"); },
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
    async () => { throw new Error("r2_legacy_direct_callback_retired"); },
  );
  server.registerTool(
    "open_project",
    {
      title: "Open Project",
      description: "📂 PROJECT (conversation-scoped) — Open one allowed project root for THIS conversation and get a handle (ph_...). Nothing server-side changes: the handle lives only in this chat, so other chats are never affected by it. After opening, ALWAYS pass project=\"<handle>\" on every file/exec/git call you make in THIS conversation (read_file, write_file, list_directory, execute_command, git_*, ...). The response includes gitReadiness for this project root: ready, untrusted_owner, not_repository or unavailable. On Windows an always-on service can be a different user than the repository owner; Git correctly blocks cross-owner repositories until an operator separately approves exact trust or the owner runs Git. HooshiX never silently disables that check. Ordinary file tools work even if Git is unavailable. The handle must already be an allowed root; grant a missing one through an approved Task step running add_workspace_roots.\n\nExample: { \"path\": \"D:/Projects/app-a\" } or { \"path\": \"app-a\" } (unique folder name)",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
      inputSchema: z.object({
        path: z.string().min(1).describe("Absolute path of an allowed project root, or its unique folder name."),
        correlationId: z.string().min(1).optional(),
      }),
    },
    async ({ path: selector, correlationId }) => {
      assertToolPermission("open_project");
      const traceId = resolveCorrelationId(correlationId);
      return auditToolCall("open_project", traceId, undefined, async () => {
        const principalId = String(getTrustedInboundIdentity().principal.id);
        const resolved = resolveProjectSelector(selector);
        const minted = mintProjectHandle(principalId, resolved.root, resolved.label);
        saveDecisionWithContext({
          action: "project_handle_mint", reason: resolved.label,
          context: { correlationId: traceId, createdAt: new Date().toISOString() },
        });
        return response({
          project: resolved.label,
          gitReadiness: await inspectGitReadiness(resolved.root),
          root: resolved.root,
          handle: minted.handle,
          expiresAt: new Date(minted.expiresAt).toISOString(),
          instruction: `Project "${resolved.label}" is open for THIS conversation only. From now on include project: "${minted.handle}" on every file, exec and git call in this conversation. Never reuse this handle in another conversation.`,
        }, traceId);
      });
    },
  );
  server.registerTool(
    "close_project",
    {
      title: "Close Project",
      description: "📂 PROJECT (conversation-scoped) — Revoke a project handle opened with open_project. Calls that still send the revoked handle are denied until open_project issues a new one.\n\nExample: { \"handle\": \"ph_Ab3xYz9Qr1Tc\" }",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      inputSchema: z.object({
        handle: z.string().min(1),
        correlationId: z.string().min(1).optional(),
      }),
    },
    async ({ handle, correlationId }) => {
      assertToolPermission("close_project");
      const traceId = resolveCorrelationId(correlationId);
      return auditToolCall("close_project", traceId, undefined, () => {
        const principalId = String(getTrustedInboundIdentity().principal.id);
        const closed = closeProjectHandle(handle, principalId);
        if (!closed)
          throw new Error("project_handle_unknown: no open project handle with that value for this credential");
        saveDecisionWithContext({
          action: "project_handle_close", reason: closed.label,
          context: { correlationId: traceId, createdAt: new Date().toISOString() },
        });
        return response({
          closed: true, project: closed.label, root: closed.root,
          instruction: "This handle is revoked. If work continues on this project in this conversation, call open_project again and use the new handle.",
        }, traceId);
      });
    },
  );
}
