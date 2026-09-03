import { describe, expect, it } from "vitest";
import { policyDecisionPoint } from "../../src/core/governance/policy-decision-point.js";
import { checkStepGovernance } from "../../src/core/governance/step-governance.js";

describe("git governance", () => {
  it("read-only git operations are allowed without approval", () => {
    const status = policyDecisionPoint.evaluate({ tool: "git_status", arguments: {} });
    expect(status.allowed).toBe(true);
    expect(status.requiresApproval).toBe(false);

    const diff = policyDecisionPoint.evaluate({ tool: "git_diff", arguments: {} });
    expect(diff.allowed).toBe(true);
    expect(diff.requiresApproval).toBe(false);
  });

  it("git mutations require approval", () => {
    for (const tool of ["git_clone", "git_commit", "git_branch", "git_checkout"]) {
      const result = policyDecisionPoint.evaluate({ tool, arguments: {} });
      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(true);
    }
  });

  it("step governance detects git mutations as approval required", () => {
    const commit = checkStepGovernance({ id: 1, action: "commit changes", tool: "git_commit", status: "pending" });
    expect(commit.decision).toBe("approval_required");

    const branch = checkStepGovernance({ id: 2, action: "create branch", tool: "git_branch", status: "pending" });
    expect(branch.decision).toBe("approval_required");

    const checkout = checkStepGovernance({ id: 3, action: "switch branch", tool: "git_checkout", status: "pending" });
    expect(checkout.decision).toBe("approval_required");

    const status = checkStepGovernance({ id: 4, action: "check status", tool: "git_status", status: "pending" });
    expect(status.decision).toBe("allow");
  });
});
