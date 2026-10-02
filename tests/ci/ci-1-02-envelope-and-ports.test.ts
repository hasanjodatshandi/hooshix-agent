import { describe, expect, it } from "vitest";
import {
  createVerifiedPrincipal,
  isPrincipalBound,
  principalHasScopes,
} from "../../src/domain/context/verified-principal.js";
import {
  createExecutionEnvelope,
  envelopesShareContext,
  isEnvelopeCurrent,
} from "../../src/domain/context/execution-envelope.js";
import { DomainError } from "../../src/domain/shared/errors.js";
import { DomainIdError } from "../../src/domain/shared/ids.js";
import type { ContextResolution } from "../../src/application/ports/outbound/context.port.js";

const basePrincipal = {
  ownerId: "owner-1",
  principalId: "principal-conn-1",
  connectionId: "conn-1",
  scopes: ["hooshix:read", "hooshix:execute"],
};

describe("CI-1.02 / VerifiedPrincipal", () => {
  it("is immutable and carries the four distinct identities", () => {
    const p = createVerifiedPrincipal({ ...basePrincipal, credentialBindingId: "bind-1" });
    expect(p.ownerId).toBe("owner-1");
    expect(p.principalId).toBe("principal-conn-1");
    expect(p.connectionId).toBe("conn-1");
    expect(p.credentialBindingId).toBe("bind-1");
    expect(Object.isFrozen(p)).toBe(true);
    // owner, principal and connection are three different values, not one.
    expect(new Set([p.ownerId, p.principalId, p.connectionId]).size).toBe(3);
  });

  it("treats a credential without a binding as unbound (I-06 precondition)", () => {
    expect(isPrincipalBound(createVerifiedPrincipal(basePrincipal))).toBe(false);
    expect(
      isPrincipalBound(createVerifiedPrincipal({ ...basePrincipal, credentialBindingId: "bind-1" })),
    ).toBe(true);
  });

  it("checks scopes deny-by-default", () => {
    const p = createVerifiedPrincipal(basePrincipal);
    expect(principalHasScopes(p, [])).toBe(true);
    expect(principalHasScopes(p, ["hooshix:read"])).toBe(true);
    expect(principalHasScopes(p, ["hooshix:read", "hooshix:execute"])).toBe(true);
    expect(principalHasScopes(p, ["hooshix:workspace:manage"])).toBe(false);
    // A single missing scope denies the whole requirement set.
    expect(principalHasScopes(p, ["hooshix:read", "hooshix:admin"])).toBe(false);
  });

  it("rejects blank identity fields", () => {
    expect(() => createVerifiedPrincipal({ ...basePrincipal, ownerId: " " })).toThrow(DomainError);
    expect(() => createVerifiedPrincipal({ ...basePrincipal, principalId: " " })).toThrow(DomainIdError);
    expect(() => createVerifiedPrincipal({ ...basePrincipal, connectionId: " " })).toThrow(DomainIdError);
    expect(() =>
      createVerifiedPrincipal({ ...basePrincipal, credentialBindingId: " " }),
    ).toThrow(DomainIdError);
  });
});

describe("CI-1.02 / ExecutionEnvelope", () => {
  function baseEnvelope(overrides: Partial<Parameters<typeof createExecutionEnvelope>[0]> = {}) {
    return createExecutionEnvelope({
      contextId: "ctx-aaaa",
      workspaceGrantId: "grant-1",
      contextEpoch: 2,
      sessionId: "session-1",
      correlationId: "corr-1",
      requestDeadlineMs: 1_000_000,
      ...overrides,
    });
  }

  it("is immutable and defaults grant version to 1", () => {
    const e = baseEnvelope();
    expect(e.grantVersion).toBe(1);
    expect(Object.isFrozen(e)).toBe(true);
  });

  it("is current only against the matching epoch AND grant version", () => {
    const e = baseEnvelope({ grantVersion: 3, contextEpoch: 2 });
    expect(isEnvelopeCurrent(e, { contextEpoch: 2, grantVersion: 3 })).toBe(true);
    // Workspace grant bumped (set_workspace in another request) -> stale.
    expect(isEnvelopeCurrent(e, { contextEpoch: 2, grantVersion: 4 })).toBe(false);
    // Ownership transferred -> stale.
    expect(isEnvelopeCurrent(e, { contextEpoch: 3, grantVersion: 3 })).toBe(false);
  });

  it("never confuses envelopes from different Contexts", () => {
    const a = baseEnvelope();
    const b = baseEnvelope({ contextId: "ctx-bbbb" });
    expect(envelopesShareContext(a, b)).toBe(false);
    expect(envelopesShareContext(a, a)).toBe(true);
  });

  it("rejects malformed inputs", () => {
    expect(() => baseEnvelope({ grantVersion: 0 })).toThrow(DomainError);
    expect(() => baseEnvelope({ contextEpoch: 0 })).toThrow(DomainIdError);
    expect(() => baseEnvelope({ requestDeadlineMs: 0 })).toThrow(DomainError);
    expect(() => baseEnvelope({ contextId: " " })).toThrow(DomainIdError);
  });
});

describe("CI-1.02 / ContextResolution is deny-by-default by construction", () => {
  it("compiles only when every refused case is represented", () => {
    // This is a type-level guarantee: the union has no `null` success shortcut.
    const outcomes: ContextResolution[] = [
      { status: "UNBOUND", reason: "CONTEXT_NOT_BOUND" },
      { status: "INACTIVE", contextState: "FROZEN", reason: "CONTEXT_INACTIVE" },
      { status: "INSUFFICIENT_SCOPE", missing: ["hooshix:admin"], reason: "SCOPE_INSUFFICIENT" },
    ];
    // A caller cannot read a Context off a refused outcome.
    for (const o of outcomes) {
      expect(o.status).not.toBe("RESOLVED");
    }
  });
});
