import { afterEach, describe, expect, it } from "vitest";
import { checkStepGovernance } from "../../src/core/governance/step-governance.js";
import { policyDecisionPoint, PolicyDecisionPoint } from "../../src/core/governance/policy-decision-point.js";

const original = process.env.HOOSHIX_PERMISSION_LEVEL;
afterEach(() => {
  if (original === undefined) delete process.env.HOOSHIX_PERMISSION_LEVEL;
  else process.env.HOOSHIX_PERMISSION_LEVEL = original;
});

describe("step governance", () => {
  it("evaluates before execution", () => {
    expect(checkStepGovernance("delete file").decision)
      .toBe("approval_required");
  });

  it("uses the typed tool as the security authority", () => {
    expect(checkStepGovernance({ id: 1, action: "harmless label", tool: "delete_file", status: "pending" }).decision)
      .toBe("approval_required");
    expect(checkStepGovernance({ id: 2, action: "harmless label", tool: "install_package", status: "pending" }).decision)
      .toBe("approval_required");
    expect(checkStepGovernance({ id: 3, action: "read deletion guide", tool: "read_file", status: "pending" }).decision)
      .toBe("allow");
  });
});

describe("PolicyDecisionPoint integration", () => {
  it("allows low-risk read operations across all services", () => {
    expect(policyDecisionPoint.evaluate({ tool: "read_file", arguments: { path: "README.md" } }).allowed).toBe(true);
    expect(policyDecisionPoint.evaluate({ tool: "list_directory", arguments: { path: "." } }).allowed).toBe(true);
    expect(policyDecisionPoint.evaluate({ tool: "search_files", arguments: { query: "TODO" } }).allowed).toBe(true);
    expect(policyDecisionPoint.evaluate({ tool: "git_status", arguments: {} }).allowed).toBe(true);
    expect(policyDecisionPoint.evaluate({ tool: "git_diff", arguments: {} }).allowed).toBe(true);
    expect(policyDecisionPoint.evaluate({ tool: "get_system_info", arguments: {} }).allowed).toBe(true);
  });

  it("requires approval for destructive filesystem operations", () => {
    const result = policyDecisionPoint.evaluate({ tool: "delete_file", arguments: { path: "x" } });
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(true);
    expect(result.risk).toBe("high");
  });

  it("requires approval for git mutations", () => {
    for (const tool of ["git_clone", "git_commit", "git_branch", "git_checkout"]) {
      const result = policyDecisionPoint.evaluate({ tool, arguments: {} });
      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(true);
    }
  });

  it("requires approval for package operations", () => {
    for (const tool of ["install_package", "remove_package", "update_package"]) {
      const result = policyDecisionPoint.evaluate({ tool, arguments: { manager: "npm", name: "lodash" } });
      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(true);
      expect(result.risk).toBe("critical");
    }
  });

  it("blocks dangerous shell commands", () => {
    const result = policyDecisionPoint.evaluate({ tool: "execute_command", arguments: { command: "node", args: ["shutdown", "/s"] } });
    expect(result.allowed).toBe(false);
  });

  it("blocks operations when permission level is insufficient", () => {
    process.env.HOOSHIX_PERMISSION_LEVEL = "READ_ONLY";
    const pdp = new PolicyDecisionPoint();
    expect(pdp.evaluate({ tool: "write_file", arguments: { path: "x", content: "x" } }).allowed).toBe(false);
    expect(pdp.evaluate({ tool: "execute_command", arguments: { command: "node", args: ["--version"] } }).allowed).toBe(false);
  });

  it("assertAllowed throws for blocked operations", () => {
    process.env.HOOSHIX_PERMISSION_LEVEL = "READ_ONLY";
    expect(() => policyDecisionPoint.assertAllowed({ tool: "write_file", arguments: { path: "x", content: "x" } })).toThrow();
  });
});
