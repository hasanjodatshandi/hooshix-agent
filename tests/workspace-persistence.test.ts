import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  __reloadWorkspaceStateForTests,
  addWorkspaceRoots,
  getWorkspaceRoot,
  listWorkspaceRoots,
  removeWorkspaceRoot,
  setActiveWorkspace,
  __clearWorkspaceStateForTests,
} from "../src/security/workspace-guard.js";
import { resolveTaskWorkspace } from "../src/security/task-workspace.js";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hooshix-workspace-"));
}

describe("persistent workspace policy", () => {
  it("restores allowed roots while leaving active workspace null", () => {
    const root = tempRoot();
    __clearWorkspaceStateForTests();
    addWorkspaceRoots([root]);
    setActiveWorkspace(root);
    __reloadWorkspaceStateForTests();
    expect(listWorkspaceRoots().some((item) => item.path === fs.realpathSync(root))).toBe(true);
    expect(getWorkspaceRoot()).toBeNull();
    removeWorkspaceRoot(root);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("does not auto-authorize a task workspace removed from policy", () => {
    const root = tempRoot();
    const root2 = tempRoot();
    __clearWorkspaceStateForTests();
    // Add two roots so we can switch active to root2, then remove root.
    addWorkspaceRoots([root, root2]);
    setActiveWorkspace(root2);
    const context = { workspace: fs.realpathSync(root) };
    removeWorkspaceRoot(root);
    expect(() => resolveTaskWorkspace(context)).toThrow(/ROOT_NO_LONGER_ALLOWED/);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(root2, { recursive: true, force: true });
  });
});
