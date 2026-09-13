import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  createWorkspaceFile,
  deleteWorkspaceFile,
  modifyWorkspaceFile,
  readWorkspaceFile,
  restoreWorkspaceFile,
  writeWorkspaceFile
} from "../src/services/filesystem/filesystem-service.js";
import { runWithPolicyApproval } from "../src/core/governance/policy-decision-point.js";
import { withAgentDatabase } from "../src/core/memory/database.js";

describe("filesystem service", () => {
  const file = "tests/runtime-files/test.txt";

  beforeEach(async () => {
    await fs.rm("tests/runtime-files", { recursive: true, force: true });
  });

  afterEach(async () => {
    await fs.rm("tests/runtime-files", { recursive: true, force: true });
  });

  it("writes and reads files", async () => {
    await writeWorkspaceFile(file, "hello agent");

    const content = await readWorkspaceFile(file);

    expect(content).toBe("hello agent");
  });

  it("modifies existing content", async () => {
    await writeWorkspaceFile(file, "version one");

    await modifyWorkspaceFile(file, "version one", "version two");

    expect(await readWorkspaceFile(file)).toBe("version two");
  });

  it("rejects empty modify searches", async () => {
    await writeWorkspaceFile(file, "unchanged");
    await expect(modifyWorkspaceFile(file, "", "replacement")).rejects.toThrow("must not be empty");
    expect(await readWorkspaceFile(file)).toBe("unchanged");
  });

  it("creates exclusively and restores the exact backup after deletion", async () => {
    await createWorkspaceFile(file, "original");
    await expect(createWorkspaceFile(file, "overwrite")).rejects.toThrow();

    const deleted = await runWithPolicyApproval("delete_file", () => deleteWorkspaceFile(file, "file-backup-test"));
    await expect(readWorkspaceFile(file)).rejects.toThrow();
    expect(deleted.backupId).toBeTypeOf("string");

    await runWithPolicyApproval("restore_file", () => restoreWorkspaceFile(deleted.backupId!, "file-backup-test"));
    expect(await readWorkspaceFile(file)).toBe("original");
  });

  it("backs up overwritten content before an atomic write", async () => {
    await writeWorkspaceFile(file, "before");
    const result = await writeWorkspaceFile(file, "after", "overwrite-test");
    expect(result.backupId).toBeTypeOf("string");
    const restored = await runWithPolicyApproval("restore_file", () => restoreWorkspaceFile(result.backupId!, "overwrite-test"));
    expect(await readWorkspaceFile(file)).toBe("before");
    expect(restored.displacedBackupId).toBeTypeOf("string");
    await runWithPolicyApproval("restore_file", () => restoreWorkspaceFile(restored.displacedBackupId!, "overwrite-test"));
    expect(await readWorkspaceFile(file)).toBe("after");
  });

  it("replaces ALL occurrences literally (no $-pattern substitution)", async () => {
    await writeWorkspaceFile(file, "a $& b $& c", "modify-test");
    const result = await modifyWorkspaceFile(file, "$&", "X", "modify-test");
    expect(result.replacedOccurrences).toBe(2);
    expect(await readWorkspaceFile(file)).toBe("a X b X c");
  });

  it("rejects sensitive files on read, write, and delete", async () => {
    await expect(readWorkspaceFile(".token", "sensitive-test")).rejects.toThrow(/sensitive-file denylist/i);
    await expect(readWorkspaceFile("config/.env", "sensitive-test")).rejects.toThrow(/sensitive-file denylist/i);
    await expect(readWorkspaceFile("home/.ssh/id_rsa", "sensitive-test")).rejects.toThrow(/sensitive-file denylist/i);
    await expect(readWorkspaceFile("cert.pem", "sensitive-test")).rejects.toThrow(/sensitive-file denylist/i);
    await expect(writeWorkspaceFile(".env", "LEAKED=1", "sensitive-test")).rejects.toThrow(/sensitive-file denylist/i);
    await expect(runWithPolicyApproval("delete_file", () => deleteWorkspaceFile(".env", "sensitive-test"))).rejects.toThrow(/sensitive-file denylist/i);
  });

  it("FS-01: backups store the canonical ABSOLUTE path, never the raw caller string", async () => {
    // Write via a RELATIVE path (the FS-01 trigger): the backup row must still
    // contain the canonical absolute path, so a restore can never re-anchor
    // it into a different active workspace.
    const result = await writeWorkspaceFile(file, "canonical-test");
    expect(result.backupId).toBeTypeOf("string");
    const row = withAgentDatabase(
      (db) => db.prepare("SELECT path FROM file_backups WHERE id = ?").get(result.backupId!) as { path: string }
    );
    expect(path.isAbsolute(row.path)).toBe(true);
    expect(path.resolve(row.path)).toBe(path.resolve(file));
  });

  it("FS-01: restore refuses a backup whose original path left the active workspace", async () => {
    const { replaceWorkspaceRoots } = await import("../src/security/workspace-guard.js");
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hx-fs01-out-"));
    try {
      // Backup taken while THIS repo is the active workspace…
      await writeWorkspaceFile(file, "isolation-test");
      const result = await writeWorkspaceFile(file, "isolation-test-v2");
      expect(result.backupId).toBeTypeOf("string");
      // …then switch the active workspace elsewhere.
      replaceWorkspaceRoots(outsideRoot);
      // The original path no longer resolves inside the active workspace —
      // restore must be REFUSED, not silently re-created here.
      await expect(
        runWithPolicyApproval("restore_file", () => restoreWorkspaceFile(result.backupId!, "fs-01-test"))
      ).rejects.toThrow(/outside the active workspace|Restore refused/i);
      // And nothing materialized in the new workspace.
      const listing = await fs.readdir(outsideRoot);
      expect(listing).toEqual([]);
    } finally {
      await fs.rm(outsideRoot, { recursive: true, force: true });
      replaceWorkspaceRoots(path.resolve("."));
    }
  });

  it("FS-01: restore refuses a legacy backup row with a relative (non-canonical) path", async () => {
    // Simulate a pre-fix row whose stored path is relative — it can never be
    // proven to belong to the current workspace, so restore must fail closed.
    const id = randomUUID();
    withAgentDatabase((db) =>
      db.prepare("INSERT INTO file_backups(id, correlation_id, path, content, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(id, "legacy-test", "relative/legacy/path.txt", Buffer.from("legacy"), new Date().toISOString())
    );
    await expect(
      runWithPolicyApproval("restore_file", () => restoreWorkspaceFile(id, "legacy-test"))
    ).rejects.toThrow(/non-canonical|Restore refused/i);
    // Nothing was materialized anywhere.
    await expect(fs.access("relative/legacy/path.txt")).rejects.toThrow();
    await expect(fs.access(path.join(os.tmpdir(), "relative"))).rejects.toThrow();
  });

});
