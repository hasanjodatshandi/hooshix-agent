import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWithTrustedInboundIdentity } from "../src/core/runtime/r2-trusted-inbound-identity.js";
import { withAgentDatabase, resetAgentDatabase, resetMigrationsFlag } from "../src/core/memory/database/index.js";
import { persistWSLWorkspaceBinding, revokeWSLWorkspaceBinding } from "../src/security/wsl-workspace-binding.js";
import { __reloadWorkspaceStateForTests } from "../src/security/workspace-guard.js";
import {
  canonicalWSLBackupTarget, stageWSLFileSnapshot,
  confirmWSLFilePostcondition, validateWSLRestoreSnapshot,
  prepareWSLRestoreDeletedRequest, prepareWSLRestoreMutationRequest
} from "../src/security/wsl-file-backup.js";
import { getStoredFileBackup } from "../src/adapters/outbound/persistence/sqlite/repositories/file-backup-idempotency.adapter.js";

const root = "wsl://Ubuntu/home/coder/workspace/Hooshix";
const fixture = {uri:root,distro:"Ubuntu",linuxRoot:"/home/coder/workspace/Hooshix",
  label:"Hooshix",ownerWindowsRoot:"D:\\Users\\Coder\\owner-root"};
function as<T>(id:string, fn:()=>T):T {
  return runWithTrustedInboundIdentity({
    principal:{id:id as never, permission:"DEVELOPER", origin:"http_oauth", scopes:[]},
    sessionId:("session-"+id) as never,
  },fn);
}
describe("WSL backups are revision-bound, durable and principal-owned",()=>{
 let dir:string;
 beforeEach(()=>{
  dir=fs.mkdtempSync(path.join(os.tmpdir(),"hooshix-wsl-file-backups-"));
  vi.stubEnv("HOOSHIX_DB_PATH",path.join(dir,"isolated.db"));
  resetAgentDatabase();resetMigrationsFlag();
 });
 afterEach(()=>{
  resetAgentDatabase();resetMigrationsFlag();vi.unstubAllEnvs();
  fs.rmSync(dir,{recursive:true,force:true});
 });
 function enroll(){
   as("alice",()=>persistWSLWorkspaceBinding(fixture));
   __reloadWorkspaceStateForTests();
 }
 it("retains an immutable absent-state snapshot with independently observed postcondition",()=>{
  enroll();
  const snapshot=as("alice",()=>stageWSLFileSnapshot(root,"src/new.txt",null,"trace-create"));
  expect(snapshot.target).toBe(root+"/src/new.txt");
  expect(snapshot.previousRevision).toBeNull();
  expect(as("alice",()=>getStoredFileBackup(snapshot.backupId)?.previous_state)).toBe("absent");
  // Reopening the SQLite connection must not orphan the immutable WSL backup.
  resetAgentDatabase();resetMigrationsFlag();__reloadWorkspaceStateForTests();
  expect(as("alice",()=>getStoredFileBackup(snapshot.backupId)?.previous_state)).toBe("absent");
  expect(()=>as("alice",()=>validateWSLRestoreSnapshot(snapshot.backupId)))
    .toThrow(/POSTCONDITION_UNKNOWN/);
  const sha="a".repeat(64);
  as("alice",()=>confirmWSLFilePostcondition(snapshot.backupId,root,"src/new.txt","present",sha));
  const validated=as("alice",()=>validateWSLRestoreSnapshot(snapshot.backupId));
  expect(validated.relative).toBe("src/new.txt");
  expect(validated.backup.post_mutation_revision).toBe(sha);
  expect(()=>as("alice",()=>confirmWSLFilePostcondition(snapshot.backupId,root,"src/new.txt","present",sha)))
    .toThrow();
 });
 it("prepares only principal-owned, verified restore-deleted requests for Linux",()=>{
  enroll();
  const b=as("alice",()=>stageWSLFileSnapshot(root,"src/restore-me.txt","original\nمتن","trace-restore"));
  expect(()=>as("alice",()=>prepareWSLRestoreDeletedRequest(b.backupId)))
    .toThrow(/POSTCONDITION_UNKNOWN/);
  as("alice",()=>confirmWSLFilePostcondition(b.backupId,root,"src/restore-me.txt","absent"));
  const proposal=as("alice",()=>prepareWSLRestoreDeletedRequest(b.backupId));
  expect(proposal).toEqual({
    root,
    request: {version:1,operation:"restore_deleted",path:"src/restore-me.txt",
      content:"original\nمتن",expectedSha256:b.previousRevision}
  });
  expect(()=>as("bob",()=>prepareWSLRestoreDeletedRequest(b.backupId)))
    .toThrow(/not_owned/);
  const created=as("alice",()=>stageWSLFileSnapshot(root,"src/new.txt",null,"trace-create"));
  as("alice",()=>confirmWSLFilePostcondition(created.backupId,root,"src/new.txt","present","a".repeat(64)));
  expect(()=>as("alice",()=>prepareWSLRestoreDeletedRequest(created.backupId)))
    .toThrow(/mode_not_supported/);
  const updated=as("alice",()=>stageWSLFileSnapshot(root,"src/update.txt","before","trace-update"));
  as("alice",()=>confirmWSLFilePostcondition(updated.backupId,root,"src/update.txt","present","b".repeat(64)));
  expect(()=>as("alice",()=>prepareWSLRestoreDeletedRequest(updated.backupId)))
    .toThrow(/mode_not_supported/);
 });
 it("prepares version-bound restore for created and modified files only for owner",()=>{
  enroll();
  const created=as("alice",()=>stageWSLFileSnapshot(root,"src/created.txt",null,"trace-created"));
  as("alice",()=>confirmWSLFilePostcondition(created.backupId,root,"src/created.txt","present","a".repeat(64)));
  expect(as("alice",()=>prepareWSLRestoreMutationRequest(created.backupId))).toEqual({
    root,request:{version:1,operation:"restore_created",path:"src/created.txt",expectedSha256:"a".repeat(64)}
  });
  const modified=as("alice",()=>stageWSLFileSnapshot(root,"src/changed.txt","previous bytes","trace-modified"));
  as("alice",()=>confirmWSLFilePostcondition(modified.backupId,root,"src/changed.txt","present","b".repeat(64)));
  expect(as("alice",()=>prepareWSLRestoreMutationRequest(modified.backupId))).toEqual({
    root,request:{version:1,operation:"restore_modified",path:"src/changed.txt",
      content:"previous bytes",expectedSha256:"b".repeat(64),restoredSha256:modified.previousRevision}
  });
  expect(()=>as("bob",()=>prepareWSLRestoreMutationRequest(created.backupId))).toThrow(/not_owned/);
  const deleted=as("alice",()=>stageWSLFileSnapshot(root,"src/gone.txt","recover","trace-deleted"));
  as("alice",()=>confirmWSLFilePostcondition(deleted.backupId,root,"src/gone.txt","absent"));
  expect(as("alice",()=>prepareWSLRestoreMutationRequest(deleted.backupId).request.operation)).toBe("restore_deleted");
 });
 it("preserves a verified previous UTF-8 revision and rejects tampered backup bytes",()=>{
  enroll();
  const b=as("alice",()=>stageWSLFileSnapshot(root,"README.md","original","trace-write"));
  expect(b.previousRevision).toMatch(/^[a-f0-9]{64}$/);
  as("alice",()=>confirmWSLFilePostcondition(b.backupId,root,"README.md","present","b".repeat(64)));
  expect(as("alice",()=>validateWSLRestoreSnapshot(b.backupId).backup.previous_state)).toBe("present");
  // Storage enforces immutable snapshot bytes even for a direct SQL writer.
  expect(()=>withAgentDatabase(db=>db.prepare("UPDATE file_backups SET content=? WHERE id=?").run(Buffer.from("tampered"),b.backupId)))
    .toThrow(/immutable_file_backup_snapshot/);
  expect(as("alice",()=>validateWSLRestoreSnapshot(b.backupId).backup.content.toString("utf8")))
    .toBe("original");
 });
 it("a different principal cannot confirm or restore someone else's snapshot",()=>{
  enroll();
  const b=as("alice",()=>stageWSLFileSnapshot(root,"file.txt",null,"trace-isolation"));
  expect(()=>as("bob",()=>validateWSLRestoreSnapshot(b.backupId))).toThrow(/not_owned/);
  expect(()=>as("bob",()=>confirmWSLFilePostcondition(b.backupId,root,"file.txt","present","c".repeat(64))))
    .toThrow();
  as("alice",()=>revokeWSLWorkspaceBinding(root));
  as("bob",()=>persistWSLWorkspaceBinding(fixture));
  __reloadWorkspaceStateForTests();
  expect(()=>as("bob",()=>validateWSLRestoreSnapshot(b.backupId))).toThrow(/not_owned/);
 });
 it("rejects cross-path acknowledgments, traversal and premature historical restores",()=>{
  enroll();
  for(const bad of ["../outside","/etc/passwd","src/../outside",".","src/.env",".git/config","src/secrets.yaml"]){
    expect(()=>canonicalWSLBackupTarget(root,bad)).toThrow();
  }
  expect(()=>as("alice",()=>stageWSLFileSnapshot(root,"src/too-big.txt","x".repeat(1024*1024+1),"trace")))
    .toThrow(/invalid_file_content/);
  const b=as("alice",()=>stageWSLFileSnapshot(root,"src/one.txt",null,"trace"));
  expect(()=>as("alice",()=>confirmWSLFilePostcondition(b.backupId,root,"src/two.txt","absent")))
    .toThrow(/target_mismatch/);
  expect(()=>as("alice",()=>confirmWSLFilePostcondition(b.backupId,root,"src/one.txt","present","bad")))
    .toThrow(/invalid_postcondition/);
  expect(()=>as("alice",()=>validateWSLRestoreSnapshot(b.backupId)))
    .toThrow(/POSTCONDITION_UNKNOWN/);
 });
});
