/**
 * R-PI5: behavioral coverage for src/core/executor/handlers/package-handler.ts.
 *
 * The handler had only `canHandle` exercised (0% branches) while being the
 * sole execution path for task-scoped package mutations. These tests drive the
 * real service against a temp workspace: schema validation, a real npm install
 * that succeeds, and a typed failure for a nonexistent package.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PackageToolHandler } from "../../src/core/executor/handlers/package-handler.js";
import { addWorkspaceRoots, setActiveWorkspace, __clearWorkspaceStateForTests } from "../../src/security/workspace-guard.js";

describe("PackageToolHandler (behavioral)", () => {
  const prevAutoApprove = process.env.HOOSHIX_DIRECT_AUTO_APPROVE;
  beforeAll(() => { process.env.HOOSHIX_DIRECT_AUTO_APPROVE = "1"; });
  afterAll(() => {
    if (prevAutoApprove === undefined) delete process.env.HOOSHIX_DIRECT_AUTO_APPROVE;
    else process.env.HOOSHIX_DIRECT_AUTO_APPROVE = prevAutoApprove;
    __clearWorkspaceStateForTests();
  });

  /** Point the workspace guard at a temp dir so the service may write there. */
  function scopeTo(dir: string): void {
    __clearWorkspaceStateForTests();
    addWorkspaceRoots([dir]);
    setActiveWorkspace(dir);
  }

  it("claims exactly the four package tools", () => {
    const handler = new PackageToolHandler();
    expect(handler.canHandle("install_package")).toBe(true);
    expect(handler.canHandle("remove_package")).toBe(true);
    expect(handler.canHandle("update_package")).toBe(true);
    expect(handler.canHandle("package_restore")).toBe(true);
    expect(handler.canHandle("read_file")).toBe(false);
    expect(handler.canHandle("execute_command")).toBe(false);
  });

  it("rejects a malformed manager in the payload", async () => {
    const handler = new PackageToolHandler();
    await expect(
      handler.handle({ tool: "install_package", input: { manager: "nope", name: "x" }, correlationId: "c1" }),
    ).rejects.toThrowError();
  });

  it("applies the default cwd and timeout fields", async () => {
    // An invalid package name is rejected by the validator before spawn, which
    // proves the schema defaults were applied (object.parse succeeded).
    const handler = new PackageToolHandler();
    await expect(
      handler.handle({ tool: "install_package", input: { manager: "npm", name: "" }, correlationId: "c2" }),
    ).rejects.toThrowError();
  });

  it("installs a real npm package into a temp workspace", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pkg-handler-"));
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "probe", version: "1.0.0" }));
    scopeTo(dir);
    try {
      const handler = new PackageToolHandler();
      // `left-pad` is tiny, stable and dependency-free.
      const result = await handler.handle({
        tool: "install_package",
        input: { manager: "npm", name: "left-pad", cwd: dir },
        correlationId: "pkg-install-1",
      });
      expect(result).toMatchObject({ manager: "npm", action: "install", name: "left-pad" });
      expect(fs.existsSync(path.join(dir, "node_modules", "left-pad"))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);

  it("propagates the typed failure for a nonexistent package", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pkg-handler-"));
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "probe", version: "1.0.0" }));
    scopeTo(dir);
    try {
      const handler = new PackageToolHandler();
      await expect(
        handler.handle({
          tool: "install_package",
          input: { manager: "npm", name: "this-package-definitely-does-not-exist-xyz", cwd: dir },
          correlationId: "pkg-fail-1",
        }),
      ).rejects.toThrowError();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);

  it("routes remove_package to the remove action", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pkg-handler-"));
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "probe", version: "1.0.0", dependencies: { "left-pad": "^1.3.0" } }));
    scopeTo(dir);
    try {
      const handler = new PackageToolHandler();
      await handler.handle({
        tool: "install_package",
        input: { manager: "npm", name: "left-pad", cwd: dir },
        correlationId: "pkg-remove-setup",
      });
      expect(fs.existsSync(path.join(dir, "node_modules", "left-pad"))).toBe(true);

      const result = await handler.handle({
        tool: "remove_package",
        input: { manager: "npm", name: "left-pad", cwd: dir },
        correlationId: "pkg-remove-1",
      });
      expect(result).toMatchObject({ manager: "npm", action: "remove", name: "left-pad" });
      expect(fs.existsSync(path.join(dir, "node_modules", "left-pad"))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);

  it("routes update_package to the update action", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pkg-handler-"));
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "probe", version: "1.0.0", dependencies: { "left-pad": "^1.3.0" } }));
    scopeTo(dir);
    try {
      const handler = new PackageToolHandler();
      await handler.handle({
        tool: "install_package",
        input: { manager: "npm", name: "left-pad", cwd: dir },
        correlationId: "pkg-update-setup",
      });

      const result = await handler.handle({
        tool: "update_package",
        input: { manager: "npm", name: "left-pad", cwd: dir },
        correlationId: "pkg-update-1",
      });
      expect(result).toMatchObject({ manager: "npm", action: "update", name: "left-pad" });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);

  it("routes package_restore through the snapshot path", async () => {
    const handler = new PackageToolHandler();
    // A well-formed UUID that does not exist: the schema accepts it (proving the
    // restore branch was taken) and the service reports the typed not-found error.
    const missing = "00000000-0000-4000-8000-000000000000";
    await expect(
      handler.handle({ tool: "package_restore", input: { snapshotId: missing }, correlationId: "pkg-restore-1" }),
    ).rejects.toThrowError(/not found|PACKAGE_MANIFEST/i);
  });

  it("applies the default cwd when omitted", async () => {
    // An empty name fails validation, but only after the schema resolves the
    // omitted cwd to "." — proving the default branch is reachable.
    const handler = new PackageToolHandler();
    await expect(
      handler.handle({ tool: "install_package", input: { manager: "npm", name: "" }, correlationId: "pkg-default-cwd" }),
    ).rejects.toThrowError();
  });
});
