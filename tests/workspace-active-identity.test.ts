import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { withAgentDatabase } from "../src/core/memory/database/index.js";
import { workspaceIdentity } from "../src/security/workspace-policy-repository.js";
import {
  __clearWorkspaceStateForTests,
  __reloadWorkspaceStateForTests,
  addWorkspaceRoots,
  getWorkspaceRoot,
  listWorkspaceRoots,
  removeWorkspaceRoot,
  setActiveWorkspace,
} from "../src/security/workspace-guard.js";

describe("workspace active flag identity", () => {
  it.skipIf(process.platform !== "win32")("marks exactly one root active when its persisted casing differs from the active path", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "HooshiX-ActiveFlag-"));
    try {
      __clearWorkspaceStateForTests();
      addWorkspaceRoots([root]);
      // Reproduce a persisted lower-case path from an earlier session while
      // a later set_workspace returns the real filesystem path with its own casing.
      withAgentDatabase((db) => {
        const result = db.prepare(
          "UPDATE workspace_roots SET path = ? WHERE normalized_path = ?"
        ).run(root.toLowerCase(), workspaceIdentity(root));
        expect(result.changes).toBe(1);
      });
      __reloadWorkspaceStateForTests();
      setActiveWorkspace(root);
      const roots = listWorkspaceRoots();
      const matching = roots.filter((item) => item.path.toLowerCase() === root.toLowerCase());
      expect(matching).toHaveLength(1);
      expect(matching[0].path.toLowerCase()).toBe(getWorkspaceRoot()?.toLowerCase());
      expect(matching[0].path).not.toBe(getWorkspaceRoot()); // Assert this test actually reproduces case drift.
      expect(matching[0].active).toBe(true);
      expect(roots.filter((item) => item.active)).toHaveLength(1);
      // Display semantics must agree with the security guard: the current
      // active root cannot be removed by supplying a different letter case.
      expect(() => removeWorkspaceRoot(root.toUpperCase())).toThrow(/active workspace/i);
    } finally {
      __clearWorkspaceStateForTests();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
