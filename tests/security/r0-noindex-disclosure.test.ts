import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDisposableFixture, type DisposableFixture } from "../helpers/r0-disposable-fixtures.js";
import { addWorkspaceRoots, removeWorkspaceRoot, setActiveWorkspace } from "../../src/security/workspace-guard.js";
import { executeShellCommand } from "../../src/services/shell/shell-service.js";

const repo = process.cwd();
let fixture: DisposableFixture | undefined;
let active: string | undefined;
afterEach(() => {
  setActiveWorkspace(repo);
  if (active) {
    try { removeWorkspaceRoot(active); } catch { /* test setup resets pool */ }
    active = undefined;
  }
  fixture?.cleanup(); fixture = undefined;
});

describe("HIGH-03 real git --no-index outside-path disclosure regression", () => {
  it.fails("a read-classified git diff cannot disclose a file outside the active workspace", async () => {
    // Both files belong to this disposable fixture. The outside file is a
    // synthetic marker, NEVER a user file or a real credential.
    fixture = createDisposableFixture("noindex");
    const inside = path.join(fixture.root, "inside");
    const outside = path.join(fixture.root, "outside");
    fs.mkdirSync(inside); fs.mkdirSync(outside);
    const source = path.join(inside, "public.txt");
    const target = path.join(outside, "outside.txt");
    const sentinel = "R0_SYNTHETIC_OUT_OF_SCOPE_CONTENT_726594";
    fs.writeFileSync(source, "visible public fixture data\n");
    fs.writeFileSync(target, sentinel + "\n");
    active = inside;
    addWorkspaceRoots([inside]);
    setActiveWorkspace(inside);
    const result = await executeShellCommand("git", ["diff", "--no-index", source, target], inside);
    // This is RED today: cwd validation alone misses path-bearing argv.
    expect(result.stdout).not.toContain(sentinel);
  }, 20000);
});
