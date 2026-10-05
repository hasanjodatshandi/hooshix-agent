import { z } from "zod";
import type { McpServer } from "../../adapters/inbound/mcp/legacy-sdk-bridge.js";

/**
 * CI-G7 — the read-only isolation probe (CIG0 §5).
 *
 * Registered only when Chat Isolation is enabled (see registry.ts), so a
 * server running with CTX_ISOLATION_MODE=OFF never advertises a tool that
 * would always report UNBOUND.
 *
 * Schema-only registration, like every other tool here: the executable body
 * flows solely through the approved R2 gateway. The probe is pure — it reads
 * the trusted inbound identity and returns pseudonyms, never raw ids.
 */
export function registerChatIsolationProbeTool(server: McpServer): void {
  server.registerTool(
    "chat_isolation_probe",
    {
      title: "Chat Isolation Probe",
      description:
        "🔍 ISOLATION — Read-only probe of the connection and Context this chat is bound to. " +
        "Returns PSEUDONYMS only (short hashes): bound_connection_pseudonym, server_context_pseudonym, " +
        "bind_state, ownership_epoch, trace_id. Never returns raw ids, bearers, or conversation content. " +
        "Run it from two chats and compare: matching connection pseudonym means the server sees one " +
        "connection; differing context pseudonyms means the two chats are isolated. " +
        "This tool exists to answer the CI-G7 feasibility question and carries no side effects.\n\nExample: {}",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      inputSchema: z.object({
        correlationId: z.string().min(1).optional(),
      }),
    },
    async () => {
      throw new Error("r2_legacy_direct_callback_retired");
    },
  );
}
