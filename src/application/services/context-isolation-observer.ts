import type { ContextResolution } from "../ports/outbound/context.port.js";
import type { ControlPlaneAuditSink, ContextResolver } from "../ports/outbound/context.port.js";
import { isCiIsolationEnabled, type CiIsolationMode } from "../../domain/context/ci-isolation-mode.js";

/**
 * CI-G3 — observe every request's Context resolution without enforcing it.
 *
 * This is the SHADOW-mode hook: after a credential is verified, resolve its
 * Context and record the outcome in the audit sink. Behavior is unchanged — the
 * request proceeds exactly as before — but the operator gains a record of what
 * the new policy WOULD have decided on real traffic. That is the evidence
 * needed before enforcement is turned on (design 10 §2).
 *
 * CI-G4 consumes the same `resolution` for enforcement, so this observer is now
 * the single resolution point on the request path: audit and decision both
 * derive from one lookup, which means the audit row always matches the decision
 * that was actually applied.
 *
 * Hexagonal discipline: this service depends only on the CI-1.02 ports and the
 * domain. The SQLite resolver/audit adapters are injected by the transport; the
 * flag comes from config, which reads the environment at the edge.
 *
 * The observer never throws: an audit failure must not break a request. Errors
 * are swallowed and reported through the return value instead. CI-G4 reads that
 * failure as a refusal — the observer's resilience contract is unchanged, but
 * its callers now act on a null resolution.
 */

export interface ObservationInput {
  /** SHA-256 of the presented credential. The only binding selector (T04). */
  readonly credentialHash: string;
  readonly action: string;
  readonly traceId: string;
  readonly mode: CiIsolationMode;
  readonly requiredScopes?: readonly string[];
}

export interface ObservationResult {
  /**
   * The resolution, or null when isolation is OFF or resolution failed. CI-G4
   * treats null as a REFUSAL under enforcement modes: a control plane that
   * cannot answer must not be read as "no Context needed" (I-06 fail-closed).
   */
  readonly resolution: ContextResolution | null;
  /** True when the audit row was written. */
  readonly audited: boolean;
  /** Set when the observation itself failed; never thrown. */
  readonly error: string | null;
}

function decisionFor(resolution: ContextResolution): "ALLOW" | "DENY" {
  return resolution.status === "RESOLVED" ? "ALLOW" : "DENY";
}

/**
 * Build the SHADOW-mode observer from its two adapters. The returned function
 * is a no-op while the flag is OFF, so a stock deployment runs no resolution and
 * writes no audit rows.
 */
export function createRequestObserver(deps: {
  readonly resolver: ContextResolver;
  readonly auditSink: ControlPlaneAuditSink;
}) {
  return async function observeRequestResolution(input: ObservationInput): Promise<ObservationResult> {
    if (!isCiIsolationEnabled(input.mode)) {
      return { resolution: null, audited: false, error: null };
    }
    try {
      const resolution = await deps.resolver.resolve({
        credentialHash: input.credentialHash,
        requiredScopes: input.requiredScopes,
      });
      const resolved = resolution.status === "RESOLVED";
      await deps.auditSink.record({
        ownerId: resolved ? resolution.binding.ownerId : undefined,
        contextId: resolved ? resolution.context.id : undefined,
        bindingId: resolved ? resolution.binding.id : undefined,
        action: input.action,
        decision: decisionFor(resolution),
        traceId: input.traceId,
      });
      return { resolution, audited: true, error: null };
    } catch (error) {
      // Observing must never take a request down. The failure is reported
      // instead, so an operator sees a missing audit row rather than a 500.
      return {
        resolution: null,
        audited: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
}
