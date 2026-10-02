import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import fsAsync from "node:fs/promises";
import path from "node:path";
import {
  setActiveWorkspace,
  addWorkspaceRoots,
  removeWorkspaceRoot,
  __seedUnrestrictedModeForTests,
} from "../../src/security/workspace-guard.js";
import { runWithPolicyApproval } from "../../src/core/governance/policy-decision-point.js";
import {
  writeWorkspaceFile,
  readWorkspaceFile,
  deleteWorkspaceFile,
} from "../../src/services/filesystem/filesystem-service.js";

const WS_A = path.resolve("tests/r2-idemp-scope-a");
const WS_B = path.resolve("tests/r2-idemp-scope-b");

const originalPermission = process.env.HOOSHIX_PERMISSION_LEVEL;
const originalOptIn = process.env.HOOSHIX_UNRESTRICTED;

beforeEach(() => {
  process.env.HOOSHIX_PERMISSION_LEVEL = "ADMIN_MODE";
  process.env.HOOSHIX_UNRESTRICTED = "1";
  fs.mkdirSync(WS_A, { recursive: true });
  fs.mkdirSync(WS_B, { recursive: true });
  addWorkspaceRoots([WS_A, WS_B]);
});

afterEach(() => {
  addWorkspaceRoots([process.cwd()]);
  setActiveWorkspace(process.cwd());
  removeWorkspaceRoot(WS_A);
  removeWorkspaceRoot(WS_B);
  fs.rmSync(WS_A, { recursive: true, force: true });
  fs.rmSync(WS_B, { recursive: true, force: true });
  if (originalPermission === undefined) delete process.env.HOOSHIX_PERMISSION_LEVEL;
  else process.env.HOOSHIX_PERMISSION_LEVEL = originalPermission;
  if (originalOptIn === undefined) delete process.env.HOOSHIX_UNRESTRICTED;
  else process.env.HOOSHIX_UNRESTRICTED = originalOptIn;
});

function useWorkspace(root: string) {
  runWithPolicyApproval("set_workspace", async () => {
    __seedUnrestrictedModeForTests(false);
  });
  setActiveWorkspace(root);
}

describe("file idempotency is scoped to the resolved workspace", () => {
  it("does not deduplicate the same key across two independent workspaces", async () => {
    useWorkspace(WS_A);
    const r1 = await writeWorkspaceFile("shared.txt", "body", undefined, {
      idempotencyKey: "scope-key-001",
    });
    expect(r1.backupId).toBeDefined();

    // Same key + same relative path in a different workspace is a DISTINCT
    // request: the write must actually happen there, not return the other
    // workspace's cached receipt.
    useWorkspace(WS_B);
    const r2 = await writeWorkspaceFile("shared.txt", "body", undefined, {
      idempotencyKey: "scope-key-001",
    });
    expect(await fsAsync.readFile(path.join(WS_B, "shared.txt"), "utf8")).toBe("body");
    expect(r2.backupId).not.toBe(r1.backupId);
  });

  it("still deduplicates an identical retry within the same workspace", async () => {
    useWorkspace(WS_A);
    const r1 = await writeWorkspaceFile("retry.txt", "body", undefined, {
      idempotencyKey: "scope-key-002",
    });
    const r2 = await writeWorkspaceFile("retry.txt", "body", undefined, {
      idempotencyKey: "scope-key-002",
    });
    expect(r2).toEqual(r1);
  });

  it("delete_file with a key does not report a deletion it did not perform in another workspace", async () => {
    useWorkspace(WS_A);
    await writeWorkspaceFile("victim.txt", "gone");

    useWorkspace(WS_B);
    await writeWorkspaceFile("victim.txt", "gone");
    const r2 = await runWithPolicyApproval("delete_file", () =>
      deleteWorkspaceFile("victim.txt", undefined, { idempotencyKey: "scope-del-001" }),
    );
    expect(r2.backupId).toBeDefined();
    expect(fs.existsSync(path.join(WS_B, "victim.txt"))).toBe(false);
    // The same key reused in workspace A must still delete A's file rather
    // than returning B's cached receipt.
    useWorkspace(WS_A);
    const r1 = await runWithPolicyApproval("delete_file", () =>
      deleteWorkspaceFile("victim.txt", undefined, { idempotencyKey: "scope-del-001" }),
    );
    expect(r1.backupId).not.toBe(r2.backupId);
    expect(fs.existsSync(path.join(WS_A, "victim.txt"))).toBe(false);
  });

  it("read_file includeSha256 returns an object carrying the hash", async () => {
    useWorkspace(WS_A);
    await writeWorkspaceFile("hashed.txt", "hello");
    const result = await readWorkspaceFile("hashed.txt", undefined, { includeSha256: true });
    expect(result).toEqual({ content: "hello", sha256: expect.any(String) });
  });
});
