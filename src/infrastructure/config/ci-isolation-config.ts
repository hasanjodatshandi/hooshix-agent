/**
 * CI — Chat Isolation feature flag (design 10 §2).
 *
 * The mode type and predicates live in the domain
 * (domain/context/ci-isolation-mode.ts); this module is the only place allowed
 * to read the environment, so it owns parsing and re-exports the rest.
 */
import { isCiIsolationMode, type CiIsolationMode } from "../../domain/context/ci-isolation-mode.js";

export type { CiIsolationMode } from "../../domain/context/ci-isolation-mode.js";
export {
  isCiIsolationEnabled,
  isCiShadowMode,
  isCiEnforcementMode,
} from "../../domain/context/ci-isolation-mode.js";

/** OFF by default. An unknown value is rejected loudly rather than silently
 *  degrading to a stricter mode, so a typo can never accidentally enable
 *  isolation (or accidentally disable it). */
export function parseCiIsolationMode(
  env: Readonly<Record<string, string | undefined>> = process.env,
): CiIsolationMode {
  const raw = (env.CTX_ISOLATION_MODE ?? "OFF").trim();
  if (!isCiIsolationMode(raw)) {
    throw new Error(
      `CTX_ISOLATION_MODE must be one of OFF, SHADOW, PER_CONNECTION, HOST_ATTESTED (got "${raw}")`,
    );
  }
  return raw;
}

/**
 * The owner identity that owns Contexts minted by per-connection provisioning.
 * A single-operator deployment has one owner who may later transfer/hand off any
 * connection's Context, so this defaults to the same stable id the legacy
 * Context used ("operator"). Each connection still gets its OWN Context; the
 * owner merely labels who can administer them. Read only here, at the config
 * boundary.
 */
export function parseCiOwnerId(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return (env.HOOSHIX_CI_OWNER_ID ?? "operator").trim() || "operator";
}
