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

    await restoreWorkspaceFile(deleted.backupId!, "file-backup-test");
    expect(await readWorkspaceFile(file)).toBe("original");
  });

  it("backs up overwritten content before an atomic write", async () => {
    await writeWorkspaceFile(file, "before");
    const result = await writeWorkspaceFile(file, "after", "overwrite-test");
    expect(result.backupId).toBeTypeOf("string");
    const restored = await restoreWorkspaceFile(result.backupId!, "overwrite-test");
    expect(await readWorkspaceFile(file)).toBe("before");
    expect(restored.backupId).toBeTypeOf("string");
    await restoreWorkspaceFile(restored.backupId!, "overwrite-test");
    expect(await readWorkspaceFile(file)).toBe("after");
  });

});
