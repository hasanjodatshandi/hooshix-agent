import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  setActiveWorkspace,
  getWorkspaceRoot,
  listWorkspaceRoots,
  removeWorkspaceRoot,
  replaceWorkspaceRoots,
  validateWorkspace,
  validateCommandCwd,
} from "../src/security/workspace-guard.js";

// Regression tests for the workspace-isolation contract:
//  1. set_workspace REPLACES the root list (previous workspace inaccessible)
//  2. File tools are scoped to the ACTIVE workspace only
//  3. execute_command cwd outside the active workspace requires approval

const wsA = fs.mkdtempSync(path.join(os.tmpdir(), "hx-wsA-"));
const wsB = fs.mkdtempSync(path.join(os.tmpdir(), "hx-wsB-"));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), "hx-outside-"));

beforeEach(() => {
  replaceWorkspaceRoots(wsA);
});

afterEach(() => {
  // restore the repo workspace for other test files
  replaceWorkspaceRoots(path.resolve("."));
});

describe("workspace isolation: root replacement", () => {
  it("set_workspace replaces the root list with only the new workspace", () => {
    fs.writeFileSync(path.join(wsA, "a.txt"), "A");
    const { resolved } = setActiveWorkspace(wsB);

    expect(resolved).toBe(fs.realpathSync(wsB));
    expect(getWorkspaceRoot()).toBe(fs.realpathSync(wsB));
    expect(listWorkspaceRoots()).toHaveLength(1);
    expect(listWorkspaceRoots()[0].path).toBe(fs.realpathSync(wsB));
  });

  it("file tools lose access to the previous workspace after a switch", () => {
    fs.writeFileSync(path.join(wsA, "secret.txt"), "A");
    setActiveWorkspace(wsB);

    // Absolute path into the previous (now unlisted) workspace is denied
    expect(() => validateWorkspace(path.join(wsA, "secret.txt"))).toThrow(/outside workspace/);
    expect(() => validateWorkspace(wsA)).toThrow(/outside workspace/);
    // The new active workspace is fine
    expect(validateWorkspace(path.join(wsB, "x.txt"))).toContain(wsB);
  });

  it("remove_workspace_root refuses to remove the active workspace", () => {
    // The active workspace is the only file-tool scope — it cannot be removed
    expect(() => removeWorkspaceRoot(wsA)).toThrow(/Cannot remove the active workspace/);
    // An unknown/unlisted path is simply not found
    expect(removeWorkspaceRoot(wsB)).toBe(false);
    // After switching, the old root is already gone (replacement semantics)
    setActiveWorkspace(wsB);
    expect(removeWorkspaceRoot(fs.realpathSync(wsA))).toBe(false);
  });

  it("delete-order: path validation precedes approval for doomed deletes", async () => {
    // deleteWorkspaceFile validates the path before the approval gate, so an
    // outside-workspace target fails with a path error even without approval
    // context. (Full delete flows are covered by the security suites.)
    expect(() => validateWorkspace(path.join(outside, "x.txt"))).toThrow(/outside workspace/);
  });
});

describe("workspace isolation: execute_command cwd gate", () => {
  it("cwd inside the active workspace is allowed without approval", () => {
    const inside = validateCommandCwd(wsA);
    expect(inside).toBe(fs.realpathSync(wsA));
  });

  it("cwd outside the active workspace requires approval", () => {
    expect(() => validateCommandCwd(outside)).toThrow(/Approval required/);
    expect(() => validateCommandCwd(os.tmpdir())).toThrow(/Approval required/);
  });

  it("approved steps may use a cwd outside the active workspace", async () => {
    const { runWithPolicyApproval } = await import("../src/core/governance/policy-decision-point.js");
    const approved = await runWithPolicyApproval("execute_command", () => Promise.resolve(validateCommandCwd(outside)));
    expect(approved).toBe(fs.realpathSync(outside));
  });

  it("non-existent cwd fails fast", () => {
    expect(() => validateCommandCwd(path.join(wsA, "does-not-exist-xyz"))).toThrow(/does not exist/);
  });
});
