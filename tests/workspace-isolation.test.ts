import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  setActiveWorkspace,
  addWorkspaceRoots,
  removeWorkspaceRoot,
  replaceWorkspaceRoots,
  listWorkspaceRoots,
  getWorkspaceRoot,
  validateWorkspace,
  validateCommandCwd,
  classifyCommandCwd,
  __clearWorkspaceStateForTests,
} from "../src/security/workspace-guard.js";

// Contract tests for the multi-root workspace pool model:
//  1. add_workspace_roots extends the allowed pool (idempotent)
//  2. set_workspace only SELECTS the active root from the pool — never mutates it
//  3. File tools are scoped to the ACTIVE workspace only
//  4. remove_workspace_root drops a non-active root; active cannot be removed

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

describe("workspace pool: add_workspace_roots", () => {
  it("adds a root to the allowed pool", () => {
    const results = addWorkspaceRoots([wsB]);
    expect(results).toEqual([{ path: fs.realpathSync(wsB), added: true }]);
    expect(listWorkspaceRoots().map((r) => r.path)).toContain(fs.realpathSync(wsB));
    // Adding does NOT switch the active workspace
    expect(getWorkspaceRoot()).toBe(fs.realpathSync(wsA));
  });

  it("is idempotent for already-allowed roots", () => {
    const first = addWorkspaceRoots([wsB]);
    const second = addWorkspaceRoots([wsB]);
    expect(second).toEqual([{ path: fs.realpathSync(wsB), added: false }]);
    expect(listWorkspaceRoots()).toHaveLength(2);
    void first;
  });

  it("rejects non-existent paths", () => {
    expect(() => addWorkspaceRoots([path.join(os.tmpdir(), "hx-nope-xyz")])).toThrow(/does not exist/);
  });

  it("first root ever added becomes the active workspace", () => {
    // Fresh state simulation is covered implicitly: replaceWorkspaceRoots sets
    // active; here verify adding keeps the existing active selection.
    addWorkspaceRoots([wsB]);
    expect(getWorkspaceRoot()).toBe(fs.realpathSync(wsA));
  });
});

describe("workspace pool: set_workspace selects only", () => {
  it("switches the active workspace without mutating the pool", () => {
    addWorkspaceRoots([wsB]);
    const { resolved, previous } = setActiveWorkspace(wsB);
    expect(resolved).toBe(fs.realpathSync(wsB));
    expect(previous).toBe(fs.realpathSync(wsA));
    // Pool unchanged — BOTH roots remain allowed
    expect(listWorkspaceRoots()).toHaveLength(2);
  });

  it("refuses to select a path that is not an allowed root", () => {
    expect(() => setActiveWorkspace(outside)).toThrow(/not an allowed workspace root/);
    expect(getWorkspaceRoot()).toBe(fs.realpathSync(wsA));
  });

  it("file tools lose access to the previous workspace after a switch", () => {
    fs.writeFileSync(path.join(wsA, "secret.txt"), "A");
    addWorkspaceRoots([wsB]);
    setActiveWorkspace(wsB);

    // Absolute path into the previous (allowed but INACTIVE) workspace is denied
    expect(() => validateWorkspace(path.join(wsA, "secret.txt"))).toThrow(/outside workspace/);
    expect(() => validateWorkspace(wsA)).toThrow(/outside workspace/);
    // The new active workspace is fine
    expect(validateWorkspace(path.join(wsB, "x.txt"))).toContain(wsB);
  });

  it("remove_workspace_root refuses to remove the active workspace", () => {
    expect(() => removeWorkspaceRoot(wsA)).toThrow(/Cannot remove the active workspace/);
    // An unknown/unlisted path is simply not found
    expect(removeWorkspaceRoot(outside)).toBe(false);
    // A non-active allowed root can be removed
    addWorkspaceRoots([wsB]);
    expect(removeWorkspaceRoot(wsB)).toBe(true);
    expect(listWorkspaceRoots()).toHaveLength(1);
  });

  it("WM-01: root identity is case-insensitive on Windows — no duplicate logical roots", () => {
    if (process.platform !== "win32") {
      // On POSIX, differing case IS a different directory — pool membership
      // stays exact-case. This test only pins the Windows canonicalization.
      return;
    }
    // wsA is already the active root; add case/separator variants of it.
    const variants = [
      wsA.toUpperCase(),
      wsA.toLowerCase(),
      wsA.replace(/\\/g, "/") + "/",
      wsA.replace(/\\/g, "/").toUpperCase() + "/",
    ];
    const results = addWorkspaceRoots(variants);
    expect(results.every((r) => r.added === false)).toBe(true);
    // The pool must still contain exactly ONE entry for this logical root.
    expect(listWorkspaceRoots()).toHaveLength(1);
    // set_workspace with a case variant still resolves to the same root.
    setActiveWorkspace(variants[2]!);
    expect(getWorkspaceRoot()).toBe(fs.realpathSync(wsA));
    // Removal via a case variant also resolves to the same root identity:
    // the active-workspace guard fires for the case-variant too.
    expect(() => removeWorkspaceRoot(wsA.toUpperCase())).toThrow(/Cannot remove the active workspace/);
    expect(() => removeWorkspaceRoot(wsA)).toThrow(/Cannot remove the active workspace/);
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

describe("workspace pool: empty by default (no implicit root)", () => {
  it("file tools are denied entirely when no active workspace is configured", () => {
    // Simulate the never-configured boot state: clear the pool AND the active
    // selection without re-seeding from env (empty-by-default contract).
    __clearWorkspaceStateForTests();
    try {
      expect(getWorkspaceRoot()).toBeNull();
      expect(listWorkspaceRoots()).toEqual([]);
      // Every path — absolute, relative, even inside the would-be env root —
      // is outside, because there is nowhere to be inside.
      expect(() => validateWorkspace("D:/anywhere/file.txt")).toThrow(/no active workspace/);
      expect(() => validateWorkspace("relative/file.txt")).toThrow(/no active workspace/);
      // cwd classification: nothing is inside a non-existent workspace.
      expect(classifyCommandCwd(path.resolve(".")).inside).toBe(false);
    } finally {
      replaceWorkspaceRoots(path.resolve("."));
    }
  });

  it("set_workspace refuses a path while the pool is empty, with an actionable error", () => {
    __clearWorkspaceStateForTests();
    try {
      expect(() => setActiveWorkspace(path.resolve("."))).toThrow(/pool is empty|not an allowed workspace root/);
    } finally {
      replaceWorkspaceRoots(path.resolve("."));
    }
  });

  it("first add_workspace_roots call both fills the pool and activates the root", () => {
    __clearWorkspaceStateForTests();
    try {
      const results = addWorkspaceRoots([wsA]);
      expect(results).toEqual([{ path: fs.realpathSync(wsA), added: true }]);
      expect(getWorkspaceRoot()).toBe(fs.realpathSync(wsA));
      // File tools now work inside it.
      expect(validateWorkspace(path.join(wsA, "x.txt"))).toContain(fs.realpathSync(wsA));
    } finally {
      replaceWorkspaceRoots(path.resolve("."));
    }
  });
});
