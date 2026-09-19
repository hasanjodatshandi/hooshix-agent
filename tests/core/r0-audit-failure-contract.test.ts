import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDisposableFixture, type DisposableFixture } from "../helpers/r0-disposable-fixtures.js";
import { addWorkspaceRoots, removeWorkspaceRoot, setActiveWorkspace } from "../../src/security/workspace-guard.js";

// Deliberately make the audit sink fail AFTER the file operation has already
// succeeded. This reproduces a split-brain business-result/telemetry failure
// without touching user files or disabling auditing in production.
vi.mock("../../src/memory/file-audit.js", () => ({
  logFileAction: vi.fn().mockRejectedValue(new Error("R0 fixture: audit sink unavailable")),
}));
import { createWorkspaceFile } from "../../src/services/filesystem/filesystem-service.js";

const repo = process.cwd();
let fixture: DisposableFixture | undefined;
afterEach(() => {
  setActiveWorkspace(repo);
  if (fixture) {
    try { removeWorkspaceRoot(fixture.root); } catch { /* reset by test setup */ }
    fixture.cleanup(); fixture = undefined;
  }
});

describe("R0 MED-05 business effect versus audit failure contract", () => {
  it.fails("a successful mutation must not report business failure solely because its audit sink failed", async () => {
    fixture = createDisposableFixture("auditsink");
    addWorkspaceRoots([fixture.root]);
    setActiveWorkspace(fixture.root);
    const target = path.join(fixture.root, "effect.txt");
    const result = await createWorkspaceFile(target, "EFFECT_COMPLETED");
    expect(result.created).toBe(true);
    expect(fs.readFileSync(target, "utf8")).toBe("EFFECT_COMPLETED");
  });
});
