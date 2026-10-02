import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createLocalToolExecutor } from "../../src/core/executor/local-tool-executor.js";
import { createDisposableFixture } from "../helpers/r0-disposable-fixtures.js";
import { addWorkspaceRoots, removeWorkspaceRoot, setActiveWorkspace } from "../../src/security/workspace-guard.js";

/**
 * The 2026-10-02 end-to-end audit found that a Task created against
 * C:\WINDOWS\TEMP failed at execution time with task_workspace_not_in_captured_roots
 * when the captured root was spelled c:\WINDOWS\TEMP. Windows roots are
 * case-insensitive, so the captured-root comparison must be too.
 */
describe("local tool executor compares captured roots case-insensitively on win32", () => {
  it.runIf(process.platform === "win32")("accepts a workspace whose case differs from the captured roots", async () => {
    const fixture = createDisposableFixture("case-roots");
    const nested = path.join(fixture.root, "nested");
    fs.mkdirSync(nested, { recursive: true });
    const real = fs.realpathSync(nested);
    const probe = path.join(real, "probe.txt");
    fs.writeFileSync(probe, "case-insensitive");
    addWorkspaceRoots([real]);
    setActiveWorkspace(real);

    // Same directory, different casing — a legal Windows spelling of the root.
    const differentlyCased = real.toUpperCase().startsWith("C:")
      ? real.replace(/^C:/i, "c:")
      : real;

    const executor = createLocalToolExecutor("case-roots-trace", "case-roots-task", {
      workspace: differentlyCased,
      roots: [real],
      allowedRootsSnapshot: [real],
      unrestricted: false,
    });
    try {
      const result = await executor("read_file", {
        id: 1,
        action: "read probe",
        tool: "read_file",
        arguments: { path: probe },
        status: "pending",
      });
      expect(JSON.stringify(result)).toContain("case-insensitive");
    } finally {
      setActiveWorkspace(process.cwd());
      try { removeWorkspaceRoot(real); } catch { /* pool reinitialized per test */ }
      fixture.cleanup();
    }
  });

  it("still rejects a workspace that is genuinely absent from the captured roots", async () => {
    const fixture = createDisposableFixture("absent-roots");
    const inside = path.join(fixture.root, "inside");
    const outside = path.join(fixture.root, "outside");
    fs.mkdirSync(inside, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    addWorkspaceRoots([inside]);
    setActiveWorkspace(inside);

    const executor = createLocalToolExecutor("absent-roots-trace", "absent-roots-task", {
      workspace: outside,
      roots: [inside],
      allowedRootsSnapshot: [inside],
      unrestricted: false,
    });
    try {
      await expect(executor("read_file", {
        id: 1,
        action: "read outside",
        tool: "read_file",
        arguments: { path: path.join(outside, "probe.txt") },
        status: "pending",
      })).rejects.toThrow("task_workspace_not_in_captured_roots");
    } finally {
      setActiveWorkspace(process.cwd());
      try { removeWorkspaceRoot(inside); } catch { /* pool reinitialized per test */ }
      fixture.cleanup();
    }
  });
});
