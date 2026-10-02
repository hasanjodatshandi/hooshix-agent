import { describe, expect, it } from "vitest";
import {
  AgentError,
  ContextEpochStaleError,
  ContextInactiveError,
  ContextNotBoundError,
  HandoffApprovalRequiredError,
  HandoffTokenExpiredError,
  ResourceUnavailableError,
  ScopeInsufficientError,
  TransferInProgressError,
  WorkspaceDeniedError,
  WorktreeConflictError,
  classifyError,
} from "../../src/core/errors.js";
import { classifyHandlerFailure } from "../../src/application/services/handler-failure-classification.js";

/** The closed CI label set (design 09 §2). */
const CI_LABELS = [
  "context_not_bound",
  "context_inactive",
  "resource_unavailable",
  "scope_insufficient",
  "workspace_denied",
  "context_epoch_stale",
  "handoff_approval_required",
  "transfer_in_progress",
  "handoff_token_expired",
  "worktree_conflict",
] as const;

describe("CI-1.03 / error taxonomy", () => {
  it("gives each CI refusal class a stable, non-interpolating sentinel message", () => {
    const cases: ReadonlyArray<readonly [new () => AgentError, string]> = [
      [ContextNotBoundError, "context_not_bound"],
      [ContextInactiveError, "context_inactive"],
      [ResourceUnavailableError, "resource_unavailable"],
      [ScopeInsufficientError, "scope_insufficient"],
      [WorkspaceDeniedError, "workspace_denied"],
      [ContextEpochStaleError, "context_epoch_stale"],
      [HandoffApprovalRequiredError, "handoff_approval_required"],
      [TransferInProgressError, "transfer_in_progress"],
      [HandoffTokenExpiredError, "handoff_token_expired"],
      [WorktreeConflictError, "worktree_conflict"],
    ];
    for (const [Ctor, message] of cases) {
      const err = new Ctor();
      expect(err.message).toBe(message);
      expect(classifyError(err)).toBe(err.code);
    }
  });

  it("classifies CI AgentErrors to their own label, not tool_handler_failure", () => {
    expect(classifyHandlerFailure(new ContextNotBoundError())).toBe("context_not_bound");
    expect(classifyHandlerFailure(new ContextInactiveError())).toBe("context_inactive");
    expect(classifyHandlerFailure(new ResourceUnavailableError())).toBe("resource_unavailable");
    expect(classifyHandlerFailure(new ScopeInsufficientError())).toBe("scope_insufficient");
    expect(classifyHandlerFailure(new WorkspaceDeniedError())).toBe("workspace_denied");
    expect(classifyHandlerFailure(new ContextEpochStaleError())).toBe("context_epoch_stale");
    expect(classifyHandlerFailure(new HandoffApprovalRequiredError())).toBe("handoff_approval_required");
    expect(classifyHandlerFailure(new TransferInProgressError())).toBe("transfer_in_progress");
    expect(classifyHandlerFailure(new HandoffTokenExpiredError())).toBe("handoff_token_expired");
    expect(classifyHandlerFailure(new WorktreeConflictError())).toBe("worktree_conflict");
  });

  it("classifies bare sentinel messages thrown without a typed code", () => {
    for (const label of CI_LABELS) {
      expect(classifyHandlerFailure(new Error(label))).toBe(label);
    }
  });

  it("never leaks which Context or record was involved (threat T07, anti-enumeration)", () => {
    // A record that does not exist and a record owned by another Context must
    // produce the identical sentinel and label — no existence oracle.
    const missing = new ResourceUnavailableError();
    const crossOwned = new ResourceUnavailableError();
    expect(missing.message).toBe(crossOwned.message);
    expect(classifyHandlerFailure(missing)).toBe(classifyHandlerFailure(crossOwned));
    // The sentinel carries no id, path or Context state.
    expect(missing.message).not.toMatch(/ctx|task|conn|bind|[0-9a-f]{8}-/);
  });

  it("keeps CI refusals distinguishable from generic execution failure", () => {
    expect(classifyHandlerFailure(new ContextNotBoundError())).not.toBe("tool_handler_failure");
    expect(classifyHandlerFailure(new ContextEpochStaleError())).not.toBe("tool_handler_failure");
    // A genuinely unknown failure still falls through to the generic label.
    expect(classifyHandlerFailure(new Error("something completely novel"))).toBe("tool_handler_failure");
  });

  it("does not classify isolation refusals as transient/retryable", () => {
    // Retrying a CONTEXT_NOT_BOUND forever would never succeed; it needs a
    // binding, not a retry. Only TIMEOUT/NETWORK are transient.
    for (const label of CI_LABELS) {
      const code = classifyError(new Error(label)) as never;
      expect(code === "TIMEOUT" || code === "NETWORK").toBe(false);
    }
  });
});
