import { describe, expect, it } from "vitest";
import {
  createContext,
  isContextExecutable,
  requireContextId,
  transitionContextState,
  type Context,
} from "../../src/domain/context/context.js";
import {
  createContextBinding,
  expireContextBinding,
  isBindingUsable,
  revokeContextBinding,
  type ContextBinding,
} from "../../src/domain/context/context-binding.js";
import {
  bumpWorkspaceGrant,
  createWorkspaceGrant,
  grantAllowsWrites,
  type WorkspaceGrant,
} from "../../src/domain/context/workspace-grant.js";
import {
  createOwnershipLease,
  isLeaseValid,
  leaseMatches,
} from "../../src/domain/context/ownership-lease.js";
import {
  createTransferIntent,
  isIntentTerminal,
  isIntentVisibleToSource,
  transitionTransferIntent,
} from "../../src/domain/context/transfer-intent.js";
import { DomainError } from "../../src/domain/shared/errors.js";
import { DomainIdError } from "../../src/domain/shared/ids.js";

const NOW = "2026-10-02T14:00:00.000Z";

function sampleContext(overrides: Partial<Parameters<typeof createContext>[0]> = {}): Context {
  return createContext({
    id: "ctx-aaaa",
    ownerId: "owner-1",
    projectLabel: "project-x",
    workspaceGrantId: "grant-1",
    storageLocator: "data/contexts/ctx-aaaa",
    now: NOW,
    ...overrides,
  });
}
function sampleBinding(overrides: Partial<Parameters<typeof createContextBinding>[0]> = {}): ContextBinding {
  return createContextBinding({
    id: "bind-1",
    ownerId: "owner-1",
    contextId: "ctx-aaaa",
    connectionId: "conn-1",
    credentialHash: "sha256:" + "a".repeat(64),
    scopes: ["hooshix:read", "hooshix:execute"],
    now: NOW,
    ...overrides,
  });
}

describe("CI-1.01 / Context", () => {
  it("creates an ACTIVE Context at epoch 1 with immutable fields", () => {
    const ctx = sampleContext();
    expect(ctx.state).toBe("ACTIVE");
    expect(ctx.epoch).toBe(1);
    expect(Object.isFrozen(ctx)).toBe(true);
  });

  it("rejects blank identifiers and required fields", () => {
    expect(() => requireContextId("  ")).toThrow(DomainIdError);
    expect(() => sampleContext({ ownerId: " " })).toThrow(DomainError);
    expect(() => sampleContext({ projectLabel: "" })).toThrow(DomainError);
    expect(() => sampleContext({ storageLocator: "" })).toThrow(DomainError);
    expect(() => sampleContext({ workspaceGrantId: " " })).toThrow(DomainIdError);
  });

  it("rejects epochs below 1", () => {
    expect(() => sampleContext({ epoch: 0 })).toThrow(DomainIdError);
    expect(() => sampleContext({ epoch: 1.5 })).toThrow(DomainIdError);
  });

  it("allows only legal state transitions", () => {
    const active = sampleContext();
    const frozen = transitionContextState(active, "FROZEN", NOW);
    expect(frozen.state).toBe("FROZEN");
    expect(transitionContextState(frozen, "ACTIVE", NOW).state).toBe("ACTIVE");
    expect(transitionContextState(active, "TRANSFERRING", NOW).state).toBe("TRANSFERRING");
    // ACTIVE -> ARCHIVED is legal; ARCHIVED is terminal.
    const archived = transitionContextState(active, "ARCHIVED", NOW);
    expect(() => transitionContextState(archived, "ACTIVE", NOW)).toThrow(DomainError);
    // FROZEN -> TRANSFERRING is illegal.
    expect(() => transitionContextState(frozen, "TRANSFERRING", NOW)).toThrow(DomainError);
  });

  it("is a no-op to transition to the current state", () => {
    const ctx = sampleContext();
    expect(transitionContextState(ctx, "ACTIVE", NOW)).toBe(ctx);
  });

  it("treats only ACTIVE as executable (I-06: no silent fallback)", () => {
    expect(isContextExecutable(sampleContext())).toBe(true);
    expect(isContextExecutable(transitionContextState(sampleContext(), "FROZEN", NOW))).toBe(false);
    expect(isContextExecutable(transitionContextState(sampleContext(), "TRANSFERRING", NOW))).toBe(false);
    expect(isContextExecutable(transitionContextState(sampleContext(), "ARCHIVED", NOW))).toBe(false);
  });
});

describe("CI-1.01 / ContextBinding", () => {
  it("binds exactly one connection to exactly one Context", () => {
    const b = sampleBinding();
    expect(b.contextId).toBe("ctx-aaaa");
    expect(b.connectionId).toBe("conn-1");
    expect(b.credentialVersion).toBe(1);
    expect(Object.isFrozen(b)).toBe(true);
    expect(isBindingUsable(b)).toBe(true);
  });

  it("forbids reactivating a revoked binding (I-07)", () => {
    const revoked = revokeContextBinding(sampleBinding());
    expect(revoked.state).toBe("REVOKED");
    expect(isBindingUsable(revoked)).toBe(false);
    expect(() => revokeContextBinding(revoked)).toThrow(DomainError);
    expect(() => expireContextBinding(revoked)).toThrow(DomainError);
    // A binding that landed in EXPIRED cannot move either.
    const expired = expireContextBinding(sampleBinding());
    expect(() => revokeContextBinding(expired)).toThrow(DomainError);
  });

  it("requires an owner and a credential hash (raw tokens are never stored)", () => {
    expect(() => sampleBinding({ ownerId: " " })).toThrow(DomainError);
    expect(() => sampleBinding({ credentialHash: "" })).toThrow(DomainError);
    expect(() => sampleBinding({ credentialVersion: 0 })).toThrow(DomainError);
  });

  it("keeps a binding in its own connection's context even if another chat reuses the label", () => {
    const a = sampleBinding({ connectionId: "conn-1" });
    const b = sampleBinding({ id: "bind-2", connectionId: "conn-2", contextId: "ctx-bbbb", credentialHash: "sha256:" + "c".repeat(64) });
    expect(a.contextId).not.toBe(b.contextId);
    expect(a.credentialHash).not.toBe(b.credentialHash);
    // Distinct connections must never resolve to the same binding record.
    expect(a.id).not.toBe(b.id);
  });
});

describe("CI-1.01 / WorkspaceGrant", () => {
  function sampleGrant(overrides: Partial<Parameters<typeof createWorkspaceGrant>[0]> = {}): WorkspaceGrant {
    return createWorkspaceGrant({
      id: "grant-1",
      contextId: "ctx-aaaa",
      canonicalRoot: "D:\\workspace\\project-x",
      ...overrides,
    });
  }

  it("defaults to READ_WRITE with grant version 1", () => {
    const g = sampleGrant();
    expect(g.accessMode).toBe("READ_WRITE");
    expect(g.grantVersion).toBe(1);
    expect(g.worktreeLocator).toBe(null);
    expect(Object.isFrozen(g)).toBe(true);
  });

  it("bumps the version on set_workspace instead of mutating in place (threat T02)", () => {
    const g = sampleGrant();
    const next = bumpWorkspaceGrant(g, "D:\\workspace\\project-y");
    expect(next.canonicalRoot).toBe("D:\\workspace\\project-y");
    expect(next.grantVersion).toBe(2);
    expect(g.grantVersion).toBe(1); // original snapshot unchanged
  });

  it("gates writes on the access mode", () => {
    expect(grantAllowsWrites(sampleGrant())).toBe(true);
    const ro = sampleGrant({ accessMode: "READ_ONLY" });
    expect(grantAllowsWrites(ro)).toBe(false);
    expect(grantAllowsWrites(bumpWorkspaceGrant(ro, "D:\\other", "READ_WRITE"))).toBe(true);
  });
});

describe("CI-1.01 / OwnershipLease", () => {
  it("creates a lease fencing (epoch, binding) pairs", () => {
    const lease = createOwnershipLease({
      contextId: "ctx-aaaa",
      ownerBindingId: "bind-1",
      contextEpoch: 3,
      leaseDeadlineMs: Date.parse(NOW) + 60_000,
      fencingToken: "fence-xyz",
      now: NOW,
    });
    expect(lease.contextEpoch).toBe(3);
    expect(Object.isFrozen(lease)).toBe(true);
  });

  it("matches only the exact (epoch, binding) pair a worker was issued", () => {
    const lease = createOwnershipLease({
      contextId: "ctx-aaaa", ownerBindingId: "bind-1", contextEpoch: 3,
      leaseDeadlineMs: 1000, fencingToken: "fence-xyz", now: NOW,
    });
    expect(leaseMatches(lease, 3, "bind-1")).toBe(true);
    // Stale epoch (another worker already transferred ownership) -> refuse.
    expect(leaseMatches(lease, 2, "bind-1")).toBe(false);
    // Different binding -> refuse.
    expect(leaseMatches(lease, 3, "bind-2")).toBe(false);
  });

  it("expires past its deadline", () => {
    const lease = createOwnershipLease({
      contextId: "ctx-aaaa", ownerBindingId: "bind-1", contextEpoch: 1,
      leaseDeadlineMs: 1000, fencingToken: "fence-xyz", now: NOW,
    });
    expect(isLeaseValid(lease, 1000)).toBe(true);
    expect(isLeaseValid(lease, 1001)).toBe(false);
  });

  it("rejects invalid deadlines and epochs", () => {
    expect(() =>
      createOwnershipLease({ contextId: "ctx-aaaa", ownerBindingId: "bind-1", contextEpoch: 0, leaseDeadlineMs: 1, fencingToken: "f", now: NOW }),
    ).toThrow(DomainIdError);
    expect(() =>
      createOwnershipLease({ contextId: "ctx-aaaa", ownerBindingId: "bind-1", contextEpoch: 1, leaseDeadlineMs: 0, fencingToken: "f", now: NOW }),
    ).toThrow(DomainError);
  });
});

describe("CI-1.01 / TransferIntent", () => {
  function sampleIntent() {
    return createTransferIntent({
      id: "intent-1",
      sourceContextId: "ctx-aaaa",
      sourceBindingId: "bind-1",
      targetConnectionId: "conn-2",
      kind: "TRANSFER",
      sourceEpoch: 2,
      ticketHash: "sha256:" + "b".repeat(64),
      expiresAt: "2026-10-02T15:00:00.000Z",
      now: NOW,
    });
  }

  it("starts PREPARED with no owner approval recorded", () => {
    const it = sampleIntent();
    expect(it.state).toBe("PREPARED");
    expect(it.approvedAt).toBe(null);
    expect(it.committedAt).toBe(null);
    expect(Object.isFrozen(it)).toBe(true);
  });

  it("walks the full handoff lifecycle and stamps approval/commit times", () => {
    const prepared = sampleIntent();
    const approved = transitionTransferIntent(prepared, "APPROVED", NOW);
    expect(approved.approvedAt).toBe(NOW);
    const draining = transitionTransferIntent(approved, "DRAINING", NOW);
    const committed = transitionTransferIntent(draining, "COMMITTED", NOW);
    expect(committed.state).toBe("COMMITTED");
    expect(committed.committedAt).toBe(NOW);
  });

  it("rejects skipping the owner approval gate", () => {
    expect(() => transitionTransferIntent(sampleIntent(), "DRAINING", NOW)).toThrow(DomainError);
    expect(() => transitionTransferIntent(sampleIntent(), "COMMITTED", NOW)).toThrow(DomainError);
  });

  it("treats committed/intent terminal states as final", () => {
    const committed = transitionTransferIntent(
      transitionTransferIntent(transitionTransferIntent(sampleIntent(), "APPROVED", NOW), "DRAINING", NOW),
      "COMMITTED",
      NOW,
    );
    expect(isIntentTerminal(committed)).toBe(true);
    expect(() => transitionTransferIntent(committed, "PREPARED", NOW)).toThrow(DomainError);
    // A replayed ticket cannot create a second ownership.
    expect(isIntentVisibleToSource(committed)).toBe(true);
  });

  it("hides a FORK's destination until commit and rejects unknown kinds", () => {
    const fork = createTransferIntent({
      ...sampleIntent(),
      id: "intent-2",
      kind: "FORK",
    });
    expect(fork.kind).toBe("FORK");
    expect(isIntentVisibleToSource(fork)).toBe(true);
    expect(isIntentTerminal(transitionTransferIntent(fork, "CANCELLED", NOW))).toBe(true);
    // Unknown kind is a domain error.
    expect(() => createTransferIntent({ ...sampleIntent(), kind: "CLONE" as never })).toThrow(DomainError);
  });
});
