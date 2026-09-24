import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { addWorkspaceRoots, removeWorkspaceRoot, setActiveWorkspace } from "../../src/security/workspace-guard.js";
import { createDisposableFixture, type DisposableFixture } from "../helpers/r0-disposable-fixtures.js";
import { withAgentDatabase } from "../../src/core/memory/database/index.js";
import { persistFileBackup } from "../../src/adapters/outbound/persistence/sqlite/repositories/file-backup-idempotency.adapter.js";
import {
  createWorkspaceFile, deleteWorkspaceFile, restoreWorkspaceFile, writeWorkspaceFile,
} from "../../src/services/filesystem/filesystem-service.js";
import { runWithPolicyApproval } from "../../src/core/governance/policy-decision-point.js";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
let fixture: DisposableFixture | undefined;
const roots = new Set<string>();
function setup(): string {
  fixture = createDisposableFixture("r4-revision");
  addWorkspaceRoots([fixture.root]);
  roots.add(fixture.root);
  setActiveWorkspace(fixture.root);
  return path.join(fixture.root, "target.txt");
}
afterEach(() => {
  setActiveWorkspace(process.cwd());
  for (const root of roots) {
    try { removeWorkspaceRoot(root); } catch { /* isolated fixture teardown */ }
  }
  roots.clear();
  fixture?.cleanup();
  fixture = undefined;
});

describe("R4.02 guarded restore: no unauthorized historical overwrite", () => {
  it("rejects an intervening content edit without overwriting or marking the backup restored", async () => {
    const target = setup();
    await fs.writeFile(target, "before");
    const mutation = await writeWorkspaceFile(target, "after");
    await fs.writeFile(target, "someone else's newer edit");
    await expect(restoreWorkspaceFile(mutation.backupId!)).rejects.toThrow(/RESTORE_REVISION_CONFLICT/);
    expect(await fs.readFile(target, "utf8")).toBe("someone else's newer edit");
    expect(withAgentDatabase(db => db.prepare("SELECT restored_at FROM file_backups WHERE id=?").get(mutation.backupId!)))
      .toMatchObject({restored_at:null});
  });

  it("rejects a different file recreated after delete; retains the intervening bytes", async () => {
    const target = setup();
    await fs.writeFile(target, "before");
    const deletion = await runWithPolicyApproval("delete_file", () => deleteWorkspaceFile(target));
    await fs.writeFile(target, "replacement");
    await expect(restoreWorkspaceFile(deletion.backupId!)).rejects.toThrow(/RESTORE_REVISION_CONFLICT/);
    expect(await fs.readFile(target, "utf8")).toBe("replacement");
  });

  it("rejects absence after an observed create or overwrite without recreating the old file", async () => {
    const target = setup();
    await fs.writeFile(target, "old");
    const mutation = await writeWorkspaceFile(target, "new");
    await fs.unlink(target);
    await expect(restoreWorkspaceFile(mutation.backupId!)).rejects.toThrow(/RESTORE_REVISION_CONFLICT/);
    await expect(fs.access(target)).rejects.toThrow();
  });

  it("rejects missing/unverified historical postcondition rather than treating it as force restore", async () => {
    const target = setup();
    await fs.writeFile(target, "now");
    const id = randomUUID();
    const pre = Buffer.from("historical");
    persistFileBackup(id,"r4-unknown",target,pre,sha("historical"));
    await expect(restoreWorkspaceFile(id)).rejects.toThrow(/RESTORE_POSTCONDITION_UNKNOWN/);
    expect(await fs.readFile(target,"utf8")).toBe("now");
  });

  it("restores present bytes with a matching observed postrevision, capturing undo of restore", async () => {
    const target = setup();
    await fs.writeFile(target, "before");
    const mutation = await writeWorkspaceFile(target, "after");
    const restore = await restoreWorkspaceFile(mutation.backupId!);
    expect(await fs.readFile(target, "utf8")).toBe("before");
    expect(restore.displacedBackupId).toBeTruthy();
    const displaced = withAgentDatabase(db=>db.prepare(
      "SELECT previous_state,previous_revision,post_mutation_state,post_mutation_revision FROM file_backups WHERE id=?"
    ).get(restore.displacedBackupId!));
    expect(displaced).toMatchObject({previous_state:"present",previous_revision:sha("after"),
      post_mutation_state:"present",post_mutation_revision:sha("before")});
    await restoreWorkspaceFile(restore.displacedBackupId!);
    expect(await fs.readFile(target,"utf8")).toBe("after");
  });

  it("restores a newly created file to absence only if its revision is unchanged", async () => {
    const target = setup();
    const mutation = await createWorkspaceFile(target,"created");
    const restore = await restoreWorkspaceFile(mutation.backupId!);
    expect(restore.previousState).toBe("absent");
    await expect(fs.access(target)).rejects.toThrow();
    expect(withAgentDatabase(db=>db.prepare(
      "SELECT post_mutation_state FROM file_backups WHERE id=?"
    ).get(restore.displacedBackupId!))).toMatchObject({post_mutation_state:"absent"});
  });

  it("does not allow the second restore to replace an independent later edit", async () => {
    const target = setup();
    await fs.writeFile(target,"before");
    const mutation = await writeWorkspaceFile(target,"after");
    await restoreWorkspaceFile(mutation.backupId!);
    await fs.writeFile(target,"new independent edit");
    await expect(restoreWorkspaceFile(mutation.backupId!)).rejects.toThrow(/RESTORE_REVISION_CONFLICT/);
    expect(await fs.readFile(target,"utf8")).toBe("new independent edit");
  });
});
