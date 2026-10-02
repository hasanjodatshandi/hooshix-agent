/**
 * Map a thrown tool-handler error to a stable, *recoverable* reason code for the
 * gateway result (see execute-tool.usecase.ts).
 *
 * The gateway must never echo arbitrary subprocess stderr, filesystem paths or
 * credential-bearing messages back to a client — but it also must not collapse
 * every failure into an opaque `tool_handler_failure`. Otherwise a caller cannot
 * distinguish "no active workspace (fixable: call set_workspace)" from "file too
 * large (fixable: read a smaller file)" from a genuine internal fault, and ends
 * up blind-retrying — which is exactly the connector instability large batches
 * hit (read_file failing with an unactionable tool_handler_failure).
 *
 * This classifier only matches (a) fixed strings thrown by our own guards and
 * services and (b) well-known Node fs errno codes. It returns a label from a
 * closed set and never interpolates the thrown message, so no path, stderr or
 * secret can leak.
 *
 * Lives under application/ (not core/) because the R0/R1 architecture gates only
 * allow application to import from application/ or domain/.
 */
export function classifyHandlerFailure(error: unknown): string {
  if (!(error instanceof Error)) return "tool_handler_failure";
  const message = error.message;
  const code = (error as NodeJS.ErrnoException & { code?: string }).code;

  // AgentError carries a typed code (src/core/errors.ts). Importing that
  // module here would break the layering rule (application may not import
  // core), so the closed code union is mirrored structurally. This keeps
  // semantic failures distinguishable instead of collapsing to
  // tool_handler_failure, which forced callers to blind-retry.
  if (typeof code === "string") {
    switch (code) {
      case "TIMEOUT": return "timeout";
      case "NETWORK": return "network";
      case "SECURITY_POLICY":
      case "GOVERNANCE_BLOCKED": return "security_policy";
      case "MISSING_CONTEXT_VARIABLE": return "missing_context_variable";
      case "FILE_NOT_FOUND": return "resource_not_found";
      case "APPROVAL_REQUIRED": return "approval_required";
      case "INVALID_ARGUMENT": return "invalid_argument";
      case "UNKNOWN_TOOL": return "unknown_tool";
      case "WORKSPACE_CONTEXT_INVALID": return "workspace_context_invalid";
      case "MEMORY_CONTENT_REQUIRED": return "memory_content_required";
      default: break; // EXECUTION or an unknown code — fall through to heuristics.
    }
  }

  // Workspace guard (src/security/workspace-guard.ts) — the single most common
  // recoverable failure: no active root, or a path the active root does not cover.
  // Same label the authorization layer already emits for a null root, so a batch
  // caller can test one string regardless of which layer caught it.
  if (message.includes("no active workspace")) return "workspace_missing_or_ungranted";
  if (message.includes("path outside workspace") || message.includes("Access denied: invalid")) return "path_outside_workspace";
  if (message.includes("Cannot remove the active workspace")) return "cannot_remove_active_workspace";

  // Filesystem service guards (src/services/filesystem/filesystem-service.ts).
  if (message.includes("sensitive-file denylist")) return "sensitive_file_rejected";
  if (message.includes("exceeds") && message.includes("limit")) return "size_limit_exceeded";
  if (message.includes("Target is not a file")) return "not_a_file";
  if (message.includes("Target already exists")) return "target_already_exists";
  if (message.includes("Target text was not found")) return "search_text_not_found";
  // Optimistic-concurrency precondition (write_file/modify_file ifMatchSha256).
  if (message.includes("STALE_WRITE")) return "stale_write";

  // Project/memory record guards.
  if (message.includes("already registered to project")) return "duplicate_project_record";

  // Task control-plane guards: a terminal or non-failed Task cannot receive
  // corrective steps, and reconciliation requires a specific terminal state.
  if (message.includes("task_append")) return "task_append_rejected";
  if (message.includes("reconciliation_requires")) return "reconciliation_state_invalid";

  // Task creation idempotency guards (task-runtime-service): the key binds the
  // exact normalized payload, so a changed payload under the same key is a
  // deterministic rejection, not a transient failure. Surfacing these as
  // tool_handler_failure forces a caller to blind-retry a request that will
  // never succeed — the caller must fetch the existing Task or use a fresh key.
  if (message === "idempotency_key_payload_conflict") return "idempotency_key_payload_conflict";
  if (message === "idempotency_key_inconsistent" || message === "idempotency_key_legacy_hash_missing")
    return "idempotency_key_inconsistent";

  // Node fs errno codes.
  if (code === "ENOENT" || message.includes("not found")) return "resource_not_found";
  if (code === "EISDIR") return "not_a_file";
  if (code === "EACCES" || code === "EPERM") return "permission_denied";

  // Transient/known categories via message heuristics (mirrors core/errors.ts
  // classifyError, kept local so this module stays layering-compliant).
  if (/timed?\s?out|timeout|ETIMEDOUT|deadline/i.test(message)) return "timeout";
  if (/network|ENOTFOUND|ECONNRESET|ECONNREFUSED|EAI_AGAIN|fetch failed/i.test(message)) return "network";
  if (/Access denied|outside workspace/i.test(message)) return "security_policy";
  if (/approval required|permission denied/i.test(message)) return "approval_required";
  if (/unknown tool|unsupported task tool/i.test(message)) return "unknown_tool";
  if (/missing context variable/i.test(message)) return "missing_context_variable";
  if (/invalid|schema|argument/i.test(message)) return "invalid_argument";

  return "tool_handler_failure";
}
