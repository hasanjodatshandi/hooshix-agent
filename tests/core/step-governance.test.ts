import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkStepGovernance } from "../../src/core/governance/step-governance.js";
import { policyDecisionPoint, PolicyDecisionPoint } from "../../src/core/governance/policy-decision-point.js";
import { addWorkspaceRoots, setActiveWorkspace, __clearWorkspaceStateForTests } from "../../src/security/workspace-guard.js";

const original = process.env.HOOSHIX_PERMISSION_LEVEL;
let wsActive = "";
let wsInactive = "";

beforeEach(() => {
  // Real temp dirs per the PM-01 repro: active + allowed-but-inactive root.
  wsActive = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hx-pm01-active-")));
  wsInactive = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hx-pm01-inactive-")));
  addWorkspaceRoots([wsActive, wsInactive]);
  setActiveWorkspace(wsActive);
});

afterEach(() => {
  if (original === undefined) delete process.env.HOOSHIX_PERMISSION_LEVEL;
  else process.env.HOOSHIX_PERMISSION_LEVEL = original;
  __clearWorkspaceStateForTests();
  fs.rmSync(wsActive, { recursive: true, force: true });
  fs.rmSync(wsInactive, { recursive: true, force: true });
});

describe("step governance", () => {
  it("evaluates before execution", () => {
    expect(checkStepGovernance("delete file").decision)
      .toBe("approval_required");
  });  it("uses the typed tool as the security authority", () => {
    expect(checkStepGovernance({ id: 1, action: "harmless label", tool: "delete_file", status: "pending" }).decision)
      .toBe("approval_required");
    expect(checkStepGovernance({ id: 2, action: "harmless label", tool: "install_package", status: "pending" }).decision)
      .toBe("approval_required");
    expect(checkStepGovernance({ id: 3, action: "read deletion guide", tool: "read_file", status: "pending" }).decision)
      .toBe("allow");
  });

  it("PM-01: package steps with cwd outside the active workspace are BLOCKED pre-approval, not approval_required", () => {
    for (const tool of ["install_package", "remove_package", "update_package"] as const) {
      const gov = checkStepGovernance({ id: 1, action: "pkg", tool, status: "pending", arguments: { manager: "npm", name: "lodash", cwd: wsInactive } });
      expect({ tool, decision: gov.decision, risk: gov.risk }).toEqual({ tool, decision: "blocked", risk: "high" });
      expect(gov.reason).toMatch(/Access denied: cwd outside workspace/);
    }
  });

  it("PM-01: package steps inside the active workspace or with omitted cwd keep normal approval flow", () => {
    // Explicit cwd inside the active workspace → normal critical/approval.
    const inside = checkStepGovernance({ id: 1, action: "pkg", tool: "install_package", status: "pending", arguments: { manager: "npm", name: "lodash", cwd: wsActive } });
    expect({ decision: inside.decision, risk: inside.risk }).toEqual({ decision: "approval_required", risk: "critical" });
    // Omitted cwd → task's persisted workspace (effectiveCwd) → also inside → approval.
    const omitted = checkStepGovernance({ id: 2, action: "pkg", tool: "install_package", status: "pending", arguments: { manager: "npm", name: "lodash" } }, wsActive);
    expect(omitted.decision).toBe("approval_required");
    // git tools keep their existing hard-scope block for outside cwds.
    const gitOutside = checkStepGovernance({ id: 3, action: "git", tool: "git_status", status: "pending", arguments: { cwd: wsInactive } });
    expect(gitOutside.decision).toBe("blocked");
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
