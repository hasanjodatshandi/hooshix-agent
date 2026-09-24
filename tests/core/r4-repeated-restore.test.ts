import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDisposableFixture, type DisposableFixture } from "../helpers/r0-disposable-fixtures.js";
import { addWorkspaceRoots, removeWorkspaceRoot, setActiveWorkspace } from "../../src/security/workspace-guard.js";
import { withAgentDatabase } from "../../src/core/memory/database/index.js";
import { createWorkspaceFile, restoreWorkspaceFile, writeWorkspaceFile } from "../../src/services/filesystem/filesystem-service.js";

let fixture: DisposableFixture | undefined;
let root: string | undefined;
function setup(): string {
  fixture=createDisposableFixture("r4-repeat");
  root=fixture.root; addWorkspaceRoots([root]); setActiveWorkspace(root);
  return path.join(root,"file.txt");
}
const row=(id:string)=>withAgentDatabase(db=>db.prepare("SELECT previous_state,previous_revision,post_mutation_state,post_mutation_revision,restored_at FROM file_backups WHERE id=?").get(id));
afterEach(()=>{
  setActiveWorkspace(process.cwd());
  if(root){try { removeWorkspaceRoot(root); }catch { /* cleanup only */ }}
  root=undefined;fixture?.cleanup();fixture=undefined;
});
describe("R4.03 repeated restore is a truthful, safe no-op",()=>{
  it("repeated restore of an absent snapshot stays absent, creates no duplicate displaced backup, preserves original restored timestamp",async()=>{
    const target=setup();
    const write=await createWorkspaceFile(target,"temporary");
    const first=await restoreWorkspaceFile(write.backupId!);
    expect(first).toMatchObject({restored:true,alreadyRestored:false,previousState:"absent"});
    expect(first.displacedBackupId).toBeTruthy();
    const original=row(write.backupId!) as {restored_at:string};
    expect(original.restored_at).toBeTruthy();
    const before=withAgentDatabase(db=>(db.prepare("SELECT COUNT(*) n FROM file_backups").get() as {n:number}).n);
    const second=await restoreWorkspaceFile(write.backupId!);
    expect(second).toMatchObject({restored:true,alreadyRestored:true,previousState:"absent"});
    expect(second.displacedBackupId).toBeUndefined();
    await expect(fs.access(target)).rejects.toThrow();
    expect(row(write.backupId!)).toEqual(original);
    expect(withAgentDatabase(db=>(db.prepare("SELECT COUNT(*) n FROM file_backups").get() as {n:number}).n)).toBe(before);
  });
  it("repeated restore of a present snapshot does not overwrite or create another backup",async()=>{
    const target=setup();await fs.writeFile(target,"previous");
    const mutation=await writeWorkspaceFile(target,"interim");
    const first=await restoreWorkspaceFile(mutation.backupId!);
    expect(first.alreadyRestored).toBe(false);
    const count=withAgentDatabase(db=>(db.prepare("SELECT COUNT(*) n FROM file_backups").get() as {n:number}).n);
    const metadata=row(mutation.backupId!);
    const second=await restoreWorkspaceFile(mutation.backupId!);
    expect(second).toMatchObject({restored:true,alreadyRestored:true,previousState:"present"});
    expect(second.displacedBackupId).toBeUndefined();
    expect(await fs.readFile(target,"utf8")).toBe("previous");
    expect(withAgentDatabase(db=>(db.prepare("SELECT COUNT(*) n FROM file_backups").get() as {n:number}).n)).toBe(count);
    expect(row(mutation.backupId!)).toEqual(metadata);
  });
  it("does not treat a later independent edit as an idempotent repeated restore",async()=>{
    const target=setup();const mutation=await createWorkspaceFile(target,"temporary");
    await restoreWorkspaceFile(mutation.backupId!);
    await fs.writeFile(target,"not-original");
    const state=row(mutation.backupId!);
    await expect(restoreWorkspaceFile(mutation.backupId!)).rejects.toThrow(/RESTORE_REVISION_CONFLICT/);
    expect(row(mutation.backupId!)).toEqual(state);
    expect(await fs.readFile(target,"utf8")).toBe("not-original");
  });
});
