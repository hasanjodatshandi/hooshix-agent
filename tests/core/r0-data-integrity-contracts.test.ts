import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDisposableFixture, type DisposableFixture } from "../helpers/r0-disposable-fixtures.js";
import { addWorkspaceRoots, removeWorkspaceRoot, setActiveWorkspace } from "../../src/security/workspace-guard.js";
import { saveProject } from "../../src/core/memory/task-repository.js";
import { writeWorkspaceFile, restoreWorkspaceFile } from "../../src/services/filesystem/filesystem-service.js";

const repo = process.cwd();
let fixture: DisposableFixture | undefined;
const roots = new Set<string>();
function scope(root: string): void { addWorkspaceRoots([root]); roots.add(root); setActiveWorkspace(root); }
afterEach(() => {
  setActiveWorkspace(repo);
  for (const root of roots) {
    try { removeWorkspaceRoot(root); } catch { /* test setup resets roots on next test */ }
  }
  roots.clear();
  fixture?.cleanup(); fixture = undefined;
});

describe("R0 MED-07/10/11/12 disposable data-integrity contracts", () => {
  it("MED-07: equivalent canonical Windows project paths must not produce duplicate identities", () => {
    fixture = createDisposableFixture("project");
    const project = path.join(fixture.root, "same-project");
    fs.mkdirSync(project);
    expect(saveProject({ name: "r0-project-a", path: project })).toBeTruthy();
    const variant = process.platform === "win32" ? project.toUpperCase() + path.sep : path.join(project, ".");
    expect(() => saveProject({ name: "r0-project-b", path: variant })).toThrow(/already registered/i);
  });

  it.fails("MED-10: reusing an absent-state backup must never create an empty file", async () => {
    fixture = createDisposableFixture("absent");
    scope(fixture.root);
    const file = path.join(fixture.root, "absent.txt");
    const write = await writeWorkspaceFile(file, "temporary");
    expect(write.previousState).toBe("absent");
    expect(write.backupId).toBeDefined();
    await restoreWorkspaceFile(write.backupId!);
    expect(fs.existsSync(file)).toBe(false);
    await restoreWorkspaceFile(write.backupId!);
    expect(fs.existsSync(file)).toBe(false);
  });

  it.fails("MED-11: restore must reject a stale revision rather than overwrite another writer's edit", async () => {
    fixture = createDisposableFixture("revision");
    scope(fixture.root);
    const file = path.join(fixture.root, "revision.txt");
    fs.writeFileSync(file, "BEFORE");
    const write = await writeWorkspaceFile(file, "DURING");
    expect(write.backupId).toBeDefined();
    fs.writeFileSync(file, "INTERVENING_EDIT");
    await expect(restoreWorkspaceFile(write.backupId!)).rejects.toThrow(/revision|conflict|stale/i);
    expect(fs.readFileSync(file, "utf8")).toBe("INTERVENING_EDIT");
  });

  it("MED-12: a backup cannot materialize into another active workspace", async () => {
    fixture = createDisposableFixture("restorescope");
    const left = path.join(fixture.root, "left");
    const right = path.join(fixture.root, "right");
    fs.mkdirSync(left); fs.mkdirSync(right);
    scope(left); addWorkspaceRoots([right]); roots.add(right);
    const original = path.join(left, "same.txt");
    fs.writeFileSync(original, "BEFORE");
    const backup = await writeWorkspaceFile(original, "AFTER");
    expect(backup.backupId).toBeTruthy();
    setActiveWorkspace(right);
    await expect(restoreWorkspaceFile(backup.backupId!)).rejects.toThrow(/outside the active workspace/i);
    expect(fs.existsSync(path.join(right, "same.txt"))).toBe(false);
    expect(fs.readFileSync(original, "utf8")).toBe("AFTER");
  });
});
