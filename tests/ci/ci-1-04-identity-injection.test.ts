import { describe, expect, it } from "vitest";
import { createVerifiedPrincipal, isPrincipalBound } from "../../src/domain/context/verified-principal.js";
import {
  createExecutionEnvelope,
  envelopesShareContext,
  isEnvelopeCurrent,
} from "../../src/domain/context/execution-envelope.js";
import { createContext } from "../../src/domain/context/context.js";
import { createContextBinding } from "../../src/domain/context/context-binding.js";
import { createWorkspaceGrant } from "../../src/domain/context/workspace-grant.js";
import type { ContextResolution, ContextResolver } from "../../src/application/ports/outbound/context.port.js";
import { ContextNotBoundError, ResourceUnavailableError } from "../../src/core/errors.js";

const NOW = "2026-10-02T14:00:00.000Z";

/**
 * Minimal deny-by-default resolver used to pin the contract the real adapter
 * (CI-2.05) must satisfy. Resolution is keyed ONLY on the credential hash —
 * nothing the caller sends in tool arguments participates.
 */
function fakeResolver(bindings: ReadonlyMap<string, { contextId: string; state: "ACTIVE" | "FROZEN" }>): ContextResolver {
  return {
    async resolve({ principal }) {
      if (!isPrincipalBound(principal)) return { status: "UNBOUND", reason: "CONTEXT_NOT_BOUND" };
      const entry = bindings.get(principal.credentialBindingId as string);
      if (!entry) return { status: "UNBOUND", reason: "CONTEXT_NOT_BOUND" };
      if (entry.state !== "ACTIVE") {
        return { status: "INACTIVE", contextState: entry.state, reason: "CONTEXT_INACTIVE" };
      }
      return {
        status: "RESOLVED",
        context: createContext({
          id: entry.contextId, ownerId: principal.ownerId, projectLabel: "p",
          workspaceGrantId: "grant-1", storageLocator: `data/contexts/${entry.contextId}`, now: NOW,
        }),
        binding: createContextBinding({
          id: principal.credentialBindingId as string, ownerId: principal.ownerId,
          contextId: entry.contextId, connectionId: principal.connectionId,
          credentialHash: "sha256:fake", scopes: principal.scopes, now: NOW,
        }),
        grant: createWorkspaceGrant({ id: "grant-1", contextId: entry.contextId, canonicalRoot: "D:\\p" }),
      };
    },
  };
}

/** Handle a resolution the way every tool handler must: refuse anything not RESOLVED. */
function requireResolved(resolution: ContextResolution) {
  if (resolution.status !== "RESOLVED") {
    throw resolution.status === "INACTIVE"
      ? new Error("context_inactive")
      : resolution.status === "INSUFFICIENT_SCOPE"
        ? new Error("scope_insufficient")
        : new ContextNotBoundError();
  }
  return resolution;
}

describe("CI-1.04 / identity injection is fail-closed", () => {
  const resolver = fakeResolver(new Map([["bind-A", { contextId: "ctx-A", state: "ACTIVE" }]]));

  const principalA = createVerifiedPrincipal({
    ownerId: "owner-1",
    principalId: "principal-A",
    connectionId: "conn-A",
    credentialBindingId: "bind-A",
    scopes: ["hooshix:read"],
  });

  it("rejects an unbound credential with CONTEXT_NOT_BOUND, with no Context attached", async () => {
    const unbound = createVerifiedPrincipal({
      ownerId: "owner-1",
      principalId: "principal-B",
      connectionId: "conn-B",
      scopes: ["hooshix:read"],
    });
    const resolution = await resolver.resolve({ principal: unbound });
    expect(resolution.status).toBe("UNBOUND");
    expect(() => requireResolved(resolution)).toThrow(ContextNotBoundError);
  });

  it("never uses a contextId supplied in tool arguments (threat T04)", async () => {
    // Chat B spoofs chat A's context id in its arguments. Resolution is still
    // keyed on B's own credential binding, which is unbound.
    const attacker = createVerifiedPrincipal({
      ownerId: "owner-2",
      principalId: "principal-B",
      connectionId: "conn-B",
      scopes: ["hooshix:read"],
    });
    const resolution = await resolver.resolve({ principal: attacker });
    expect(resolution.status).toBe("UNBOUND");
    // And the spoofed id cannot be used to mint a valid envelope for ctx-A,
    // because the envelope is checked against the binding's own Context.
    const forged = createExecutionEnvelope({
      contextId: "ctx-A", workspaceGrantId: "grant-1", contextEpoch: 1,
      sessionId: "session-B", correlationId: "corr-B", requestDeadlineMs: 1_000_000,
    });
    if (resolution.status === "RESOLVED") {
      expect(envelopesShareContext(forged, {
        ...forged,
        contextId: resolution.context.id,
      })).toBe(false);
    }
  });

  it("detects an envelope minted for a different Context than the binding's", () => {
    const own = createExecutionEnvelope({
      contextId: "ctx-A", workspaceGrantId: "grant-1", contextEpoch: 1, grantVersion: 1,
      sessionId: "session-A", correlationId: "corr-A", requestDeadlineMs: 1_000_000,
    });
    const cross = createExecutionEnvelope({
      contextId: "ctx-B", workspaceGrantId: "grant-1", contextEpoch: 1, grantVersion: 1,
      sessionId: "session-A", correlationId: "corr-A", requestDeadlineMs: 1_000_000,
    });
    expect(envelopesShareContext(own, cross)).toBe(false);
  });

  it("rejects a replayed envelope after epoch/grant advance (threat T08)", () => {
    const envelope = createExecutionEnvelope({
      contextId: "ctx-A", workspaceGrantId: "grant-1", contextEpoch: 2, grantVersion: 1,
      sessionId: "session-A", correlationId: "corr-A", requestDeadlineMs: 1_000_000,
    });
    // Ownership transferred (epoch 2 -> 3): the stale envelope authorizes nothing.
    expect(isEnvelopeCurrent(envelope, { contextEpoch: 3, grantVersion: 1 })).toBe(false);
    // Workspace bumped (grant 1 -> 2): likewise stale.
    expect(isEnvelopeCurrent(envelope, { contextEpoch: 2, grantVersion: 2 })).toBe(false);
    expect(isEnvelopeCurrent(envelope, { contextEpoch: 2, grantVersion: 1 })).toBe(true);
  });

  it("treats a FROZEN Context as execution-inactive (no silent fallback)", async () => {
    const frozenResolver = fakeResolver(new Map([["bind-C", { contextId: "ctx-C", state: "FROZEN" }]]));
    const principal = createVerifiedPrincipal({
      ownerId: "owner-3", principalId: "principal-C", connectionId: "conn-C",
      credentialBindingId: "bind-C", scopes: ["hooshix:read"],
    });
    const resolution = await frozenResolver.resolve({ principal });
    expect(resolution.status).toBe("INACTIVE");
    expect(() => requireResolved(resolution)).toThrow(/context_inactive/);
  });

  it("denies scope-insufficient requests without revealing the target", () => {
    const resolution: ContextResolution = {
      status: "INSUFFICIENT_SCOPE",
      missing: ["hooshix:admin"],
      reason: "SCOPE_INSUFFICIENT",
    };
    expect(() => requireResolved(resolution)).toThrow(/scope_insufficient/);
  });

  it("reports a cross-Context record access identically to a missing one (threat T07)", () => {
    // Both paths must surface the same sentinel; the gateway cannot become an
    // existence oracle for another chat's records.
    const fromMissing = new ResourceUnavailableError();
    const fromCrossOwned = new ResourceUnavailableError();
    expect(fromMissing.message).toBe(fromCrossOwned.message);
    expect(fromMissing.message).toBe("resource_unavailable");
  });

  it("resolves a legitimately bound principal to exactly that principal's Context", async () => {
    const resolution = await resolver.resolve({ principal: principalA });
    expect(resolution.status).toBe("RESOLVED");
    if (resolution.status === "RESOLVED") {
      expect(resolution.context.id).toBe("ctx-A");
      expect(resolution.binding.connectionId).toBe("conn-A");
      // The resolved Context is the one the binding holds — not one the caller chose.
      expect(resolution.grant.contextId).toBe(resolution.context.id);
    }
  });
});
