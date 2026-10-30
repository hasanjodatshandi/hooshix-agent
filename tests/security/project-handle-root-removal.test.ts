import { afterEach, describe, expect, it } from "vitest";
import { createDisposableFixture, type DisposableFixture } from "../helpers/r0-disposable-fixtures.js";
import {
  addWorkspaceRoots,
  getWorkspaceRoot,
  removeWorkspaceRoot,
  setActiveWorkspace,
} from "../../src/security/workspace-guard.js";
import {
  closeProjectHandle,
  mintProjectHandle,
  resolveProjectHandle,
} from "../../src/security/project-handles.js";

let fixture: DisposableFixture | undefined;
let priorRoot: string | null = null;

afterEach(() => {
  if (priorRoot) setActiveWorkspace(priorRoot);
  if (fixture) {
    removeWorkspaceRoot(fixture.root);
    fixture.cleanup();
  }
  fixture = undefined;
  priorRoot = null;
});

describe("project handle root removal", () => {
  it("invalidates a handle immediately when its root leaves the allowed pool", () => {
    priorRoot = getWorkspaceRoot();
    expect(priorRoot).toBeTruthy();
    fixture = createDisposableFixture("ph-root-removal");
    addWorkspaceRoots([fixture.root]);
    setActiveWorkspace(fixture.root);
    const handle = mintProjectHandle("test-principal", fixture.root, "fixture").handle;
    expect(resolveProjectHandle(handle, "test-principal").ok).toBe(true);

    setActiveWorkspace(priorRoot!);
    expect(removeWorkspaceRoot(fixture.root)).toBe(true);

    const after = resolveProjectHandle(handle, "test-principal");
    expect(after).toEqual({ ok: false, error: "unknown" });
    closeProjectHandle(handle, "test-principal");
  });
});
