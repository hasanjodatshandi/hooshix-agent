import {createHash, randomUUID} from "node:crypto";
import {z} from "zod";
import {getTrustedInboundIdentity} from "../../runtime/r2-trusted-inbound-identity.js";
import type {ToolHandler, ToolHandlerContext} from "./tool-handler.js";

/**
 * CI-G7 — the read-only isolation probe (CIG0 §5 checklist).
 *
 * The sole purpose of this tool is to let the owner answer the gate's
 * definitive question — "does the server see a distinct, verifiable identity
 * for chat A and chat B?" — by running it from two real chats and comparing
 * what the server reports. It is the evidence instrument for CI-G7, not a
 * general-purpose inspection API.
 *
 * Disclosure discipline (design 03 §4 / threat T07): everything returned is a
 * PSEUDONYM — the first 12 hex chars of a SHA-256 over the real id. That is
 * short enough for a human to eyeball "these two probes differ / match" yet
 * carries no way back to the underlying connection id, Context id, or
 * principal. The tool never returns the raw ids, the bearer, or any
 * conversation content.
 */

/** Short, stable, non-reversible identifier for eyeballing match/mismatch. */
function pseudonym(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 12);
}

export class ChatIsolationProbeHandler implements ToolHandler {
  readonly name = "chat_isolation_probe" as const;

  readonly inputSchema = z.object({
    correlationId: z.string().min(1).optional(),
  });

  canHandle(tool: string): boolean {
    return tool === this.name;
  }

  async handle(context: ToolHandlerContext): Promise<unknown> {
    void context;
    const identity = getTrustedInboundIdentity();
    const resolved = identity.resolvedContext;
    return {
      /** The connection this request is bound to. Two chats that agree here
       *  are the SAME connection to the server. */
      bound_connection_pseudonym: pseudonym(identity.principal.id),
      /** The Context the server resolved for this request. Two chats that
       *  differ here are isolated at the Context level (the goal). */
      server_context_pseudonym: resolved ? pseudonym(resolved.contextId) : null,
      /** Whether a Context was resolved at all. UNBOUND means the credential
       *  has no binding — the request would be refused under PER_CONNECTION. */
      bind_state: resolved ? "RESOLVED" : "UNBOUND",
      /** The ownership epoch observed at authorisation, so a probe taken
       *  before and after a transfer shows the epoch moved. */
      ownership_epoch: resolved ? resolved.ownershipEpoch : null,
      /** Per-request id for the operator's trace. */
      trace_id: randomUUID(),
      /** Explicitly never present: bearer, secrets, conversation text,
       *  raw ids. This field exists so its absence is pinned in tests. */
      _disclosure: "pseudonyms_only_no_raw_identity",
    };
  }
}
