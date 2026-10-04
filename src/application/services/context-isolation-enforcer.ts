import type { ContextResolution } from "../ports/outbound/context.port.js";
import { isCiEnforcementMode, type CiIsolationMode } from "../../domain/context/ci-isolation-mode.js";

/**
 * CI-G4 — the first real enforcement on the live request path.
 *
 * CI-G3 only OBSERVED: the resolution was computed and audited, but the request
 * always proceeded. That was deliberate — you cannot enforce a policy you have
 * never watched run against real traffic (design 10 §2). CI-G4 turns the
 * observed refusal into an actual refusal: while the flag is in an enforcement
 * mode, a credential that does not resolve to an ACTIVE Context is rejected
 * before any session, concurrency or tool work happens.
 *
 * This is a pure decision function over a resolution that was already computed
 * (by the SHADOW observer or by any future caller). It never reaches for a
 * database, never throws, and never degrades to "allow" — an enforcement mode
 * that cannot prove a Context is bound has no business serving the request
 * (I-06: unbound or ambiguous never falls back to the last active workspace).
 *
 * The refusal body uses the closed CI sentinel set (CI-1.03 / design 09 §2):
 * stable, non-interpolating, leaking no Context id, binding id or path — so the
 * response carries no existence oracle (threat T07).
 *
 * HOST_ATTESTED is also an enforcement mode: it adds the attestation layer in
 * CI-G7 on top of this same resolution check, it does not weaken it.
 */
export interface EnforcementInput {
  readonly mode: CiIsolationMode;
  /** The resolution, or null when resolution itself failed (observer `error`). */
  readonly resolution: ContextResolution | null;
}
export interface EnforcementResult {
  readonly allowed: boolean;
  /** Present only when refused: a stable CI sentinel the client can react to. */
  readonly reason?: string;
}

/**
 * Map a refused resolution onto its stable sentinel label. Only RESOLVED is
 * permitted; every other status — including a null resolution, i.e. the control
 * plane could not answer at all — is refused.
 */
export function decideEnforcement(input: EnforcementInput): EnforcementResult {
  if (!isCiEnforcementMode(input.mode)) {
    // OFF and SHADOW never change behaviour. SHADOW still audits via the
    // observer; enforcement is the caller's separate concern.
    return { allowed: true };
  }
  if (input.resolution && input.resolution.status === "RESOLVED") {
    return { allowed: true };
  }
  // Fail closed (I-06): a resolution we could not even compute is treated as
  // unbound rather than allowed — the control plane being unavailable must not
  // silently disable isolation.
  const reason = !input.resolution
    ? "context_not_bound"
    : sentinelFor(input.resolution);
  return { allowed: false, reason };
}

function sentinelFor(resolution: ContextResolution): string {
  switch (resolution.status) {
    case "UNBOUND":
      return "context_not_bound";
    case "INACTIVE":
      return "context_inactive";
    case "INSUFFICIENT_SCOPE":
      return "scope_insufficient";
    default:
      // RESOLVED is handled by the caller; any future status refuses too.
      return "context_not_bound";
  }
}
