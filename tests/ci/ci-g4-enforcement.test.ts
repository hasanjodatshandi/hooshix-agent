import { describe, expect, it } from "vitest";
import { decideEnforcement } from "../../src/application/services/context-isolation-enforcer.js";
import type { ContextResolution } from "../../src/application/ports/outbound/context.port.js";
import { createContext } from "../../src/domain/context/context.js";
import { createContextBinding } from "../../src/domain/context/context-binding.js";
import { createWorkspaceGrant } from "../../src/domain/context/workspace-grant.js";

/**
 * CI-G4 — unit tests for the enforcement decision function.
 *
 * CI-G3 built the SHADOW observer; CI-G4 is the first time a non-RESOLVED
 * resolution actually stops a request. These tests pin the decision table
 * itself, independent of transport, so the live-path tests only have to prove
 * the decision is *applied*.
 *
 * The contract being pinned:
 *  - OFF and SHADOW never refuse (SHADOW audits, but never changes behaviour).
 *  - PER_CONNECTION and HOST_ATTESTED refuse everything that is not RESOLVED.
 *  - A resolution that could not even be computed is a refusal (fail-closed,
 *    invariant I-06): an unavailable control plane must not read as "allowed".
 *  - The refusal reason is the closed CI sentinel set — no ids, no paths.
 */

const NOW = "2026-10-04T12:00:00.000Z";

const RESOLVED: ContextResolution = {
  status: "RESOLVED",
  context: createContext({
    id: "ctx-a1b2c3d4-0000-4000-8000-000000000001",
    ownerId: "owner-alice",
    projectLabel: "alpha",
    workspaceGrantId: "grant-alpha-0000-4000-8000-000000000001",
    storageLocator: "data/alpha",
    now: NOW,
  }),
  binding: createContextBinding({
    id: "bind-alpha-0000-4000-8000-000000000001",
    ownerId: "owner-alice",
    contextId: "ctx-a1b2c3d4-0000-4000-8000-000000000001",
    connectionId: "conn-alpha-0000-4000-8000-000000000001",
    principalId: "principal-alice",
    credentialHash: "abc123",
    scopes: ["hooshix:read"],
    now: NOW,
  }),
  grant: createWorkspaceGrant({
    id: "grant-alpha-0000-4000-8000-000000000001",
    contextId: "ctx-a1b2c3d4-0000-4000-8000-000000000001",
    canonicalRoot: "/workspace/alpha",
  }),
};
const UNBOUND: ContextResolution = { status: "UNBOUND", reason: "CONTEXT_NOT_BOUND" };
const INACTIVE: ContextResolution = {
  status: "INACTIVE",
  contextState: "FROZEN",
  reason: "CONTEXT_INACTIVE",
};
const INSUFFICIENT_SCOPE: ContextResolution = {
  status: "INSUFFICIENT_SCOPE",
  missing: ["hooshix:execute"],
  reason: "SCOPE_INSUFFICIENT",
};

describe("CI-G4 / enforcement decision", () => {
  it("never refuses while isolation is OFF", () => {
    for (const resolution of [RESOLVED, UNBOUND, INACTIVE, INSUFFICIENT_SCOPE, null]) {
      expect(decideEnforcement({ mode: "OFF", resolution })).toEqual({ allowed: true });
    }
  });

  it("never refuses while isolation is SHADOW — observation is not enforcement", () => {
    // SHADOW must keep serving even an unbound credential; it records the
    // decision in the audit sink instead of applying it (design 10 §2).
    for (const resolution of [RESOLVED, UNBOUND, INACTIVE, INSUFFICIENT_SCOPE, null]) {
      expect(decideEnforcement({ mode: "SHADOW", resolution })).toEqual({ allowed: true });
    }
  });

  it("allows a RESOLVED Context under PER_CONNECTION", () => {
    expect(decideEnforcement({ mode: "PER_CONNECTION", resolution: RESOLVED })).toEqual({
      allowed: true,
    });
  });

  it("allows a RESOLVED Context under HOST_ATTESTED", () => {
    expect(decideEnforcement({ mode: "HOST_ATTESTED", resolution: RESOLVED })).toEqual({
      allowed: true,
    });
  });

  it("refuses an unbound credential with the context_not_bound sentinel", () => {
    expect(decideEnforcement({ mode: "PER_CONNECTION", resolution: UNBOUND })).toEqual({
      allowed: false,
      reason: "context_not_bound",
    });
  });

  it("refuses an inactive Context with the context_inactive sentinel", () => {
    expect(decideEnforcement({ mode: "PER_CONNECTION", resolution: INACTIVE })).toEqual({
      allowed: false,
      reason: "context_inactive",
    });
  });

  it("refuses a scope-insufficient resolution with the scope_insufficient sentinel", () => {
    expect(decideEnforcement({ mode: "HOST_ATTESTED", resolution: INSUFFICIENT_SCOPE })).toEqual({
      allowed: false,
      reason: "scope_insufficient",
    });
  });

  it("fails closed when the resolution itself could not be computed", () => {
    // The control plane being unavailable (observer `error` path) must never be
    // interpreted as "no isolation needed" — invariant I-06.
    expect(decideEnforcement({ mode: "PER_CONNECTION", resolution: null })).toEqual({
      allowed: false,
      reason: "context_not_bound",
    });
    expect(decideEnforcement({ mode: "HOST_ATTESTED", resolution: null })).toEqual({
      allowed: false,
      reason: "context_not_bound",
    });
  });

  it("never leaks a Context, binding or principal id in the refusal reason", () => {
    const reasons = [
      decideEnforcement({ mode: "PER_CONNECTION", resolution: UNBOUND }).reason,
      decideEnforcement({ mode: "PER_CONNECTION", resolution: INACTIVE }).reason,
      decideEnforcement({ mode: "PER_CONNECTION", resolution: INSUFFICIENT_SCOPE }).reason,
      decideEnforcement({ mode: "PER_CONNECTION", resolution: null }).reason,
    ];
    for (const reason of reasons) {
      expect(reason).toMatch(/^(context_not_bound|context_inactive|scope_insufficient)$/);
      expect(reason).not.toMatch(/ctx|bind|conn|grant|[0-9a-f]{8}-/);
    }
  });
});
