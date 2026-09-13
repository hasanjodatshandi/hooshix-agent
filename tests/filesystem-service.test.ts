import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import {
  createWorkspaceFile,
  deleteWorkspaceFile,
  modifyWorkspaceFile,
  readWorkspaceFile,
  restoreWorkspaceFile,
  writeWorkspaceFile
} from "../src/services/filesystem/filesystem-service.js";
import { runWithPolicyApproval } from "../src/core/governance/policy-decision-point.js";

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

});
