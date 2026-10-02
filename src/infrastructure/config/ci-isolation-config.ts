/**
 * CI — Chat Isolation feature flag (design 10 §2).
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
 */
export type CiIsolationMode = "OFF" | "SHADOW" | "PER_CONNECTION" | "HOST_ATTESTED";

const VALID_MODES: ReadonlySet<CiIsolationMode> = new Set([
  "OFF", "SHADOW", "PER_CONNECTION", "HOST_ATTESTED",
]);

/** OFF by default. An unknown value is rejected loudly rather than silently
 *  degrading to a stricter mode, so a typo can never accidentally enable
 *  isolation (or accidentally disable it). */
export function parseCiIsolationMode(
  env: Readonly<Record<string, string | undefined>> = process.env,
): CiIsolationMode {
  const raw = (env.CTX_ISOLATION_MODE ?? "OFF").trim();
  if (!VALID_MODES.has(raw as CiIsolationMode)) {
    throw new Error(
      `CTX_ISOLATION_MODE must be one of OFF, SHADOW, PER_CONNECTION, HOST_ATTESTED (got "${raw}")`,
    );
  }
  return raw as CiIsolationMode;
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
