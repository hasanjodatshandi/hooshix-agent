/**
 * CI — Chat Isolation mode (design 10 §2), as a domain value.
 *
 * The program ships incrementally with the flag OFF by default. Every CI code
 * path is additive: OFF means byte-for-byte the shipped behavior, so deploying
 * the code cannot change the live service.
 *
 *   OFF            default; no context resolution, principal stays "operator"
 *   SHADOW         resolve the Context for every request and write the decision
 *                  to security_audit, but do not enforce — used to compare old
 *                  and new policy without risking the live flow
 *   PER_CONNECTION enforce per-connection isolation (model C): each OAuth grant
 *                  mints its own connection id, principal and Context
 *   HOST_ATTESTED  additionally accept a host-attested conversation claim and
 *                  map it to a Context (model H) — only after CI-G7
 *
 * The parse lives in infrastructure/config (the only layer allowed to read the
 * environment); this module owns the type and the predicates so that the
 * application services can depend on the domain, not on config.
 */
export type CiIsolationMode = "OFF" | "SHADOW" | "PER_CONNECTION" | "HOST_ATTESTED";

const VALID_MODES: ReadonlySet<CiIsolationMode> = new Set([
  "OFF", "SHADOW", "PER_CONNECTION", "HOST_ATTESTED",
]);

export function isCiIsolationMode(value: string): value is CiIsolationMode {
  return VALID_MODES.has(value as CiIsolationMode);
}

export function isCiIsolationEnabled(mode: CiIsolationMode): boolean {
  return mode !== "OFF";
}

/** SHADOW observes but does not enforce. */
export function isCiShadowMode(mode: CiIsolationMode): boolean {
  return mode === "SHADOW";
}

/** Enforcement modes change authorization decisions. */
export function isCiEnforcementMode(mode: CiIsolationMode): boolean {
  return mode === "PER_CONNECTION" || mode === "HOST_ATTESTED";
}
