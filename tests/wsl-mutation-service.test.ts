import {createHash} from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {beforeEach,afterEach,describe,expect,it,vi} from "vitest";
import {runWithTrustedInboundIdentity} from "../src/core/runtime/r2-trusted-inbound-identity.js";
import {resetAgentDatabase,resetMigrationsFlag} from "../src/core/memory/database/index.js";
import {getStoredFileBackup} from "../src/adapters/outbound/persistence/sqlite/repositories/file-backup-idempotency.adapter.js";
import {persistWSLWorkspaceBinding} from "../src/security/wsl-workspace-binding.js";
import {__reloadWorkspaceStateForTests} from "../src/security/workspace-guard.js";
import {mutateWSLFile} from "../src/security/wsl-mutation-service.js";

const fake=vi.hoisted(()=>({
 files:new Map<string,string>(),
 failAfterChange:false,
 calls:[] as Array<{operation:string;path:string}>,
}));
const digest=(v:string)=>createHash("sha256").update(v,"utf8").digest("hex");
vi.mock("../src/security/wsl-workspace-client.js",async()=>{
 const crypto=await import("node:crypto");
 const sha=(s:string)=>crypto.createHash("sha256").update(s,"utf8").digest("hex");
 return {
  invokeWSLFileOperation:vi.fn(async(_root:string,operation:string,target:string)=>{
   const value=fake.files.get(target);
   if(operation==="stat")return value===undefined?
     {ok:true,state:"absent"}:{ok:true,state:"present",sha256:sha(value)};
   if(operation==="read"){
    if(value===undefined)throw new Error("file_unavailable");
    return {ok:true,content:value,sha256:sha(value)};
   }
   throw new Error("unexpected_file_read_operation");
  }),
  invokeWSLMutationRequest:vi.fn(async(_root:string,req:{
   operation:string;path:string;content?:string;query?:string;
   expectedSha256?:string;restoredSha256?:string;
  })=>{
    fake.calls.push({operation:req.operation,path:req.path});
    const old=fake.files.get(req.path);
    if(req.operation==="create"||req.operation==="restore_deleted"){
     if(old!==undefined)throw new Error("create_exists");
     fake.files.set(req.path,req.content??"");
     if(fake.failAfterChange)throw new Error("wslfs_write_outcome_unknown");
     return {ok:true,created:true,restored:req.operation==="restore_deleted",sha256:sha(req.content??"")};
    }
    if(old===undefined||sha(old)!==req.expectedSha256)throw new Error("revision_conflict");
    if(req.operation==="delete_existing"||req.operation==="restore_created"){
     fake.files.delete(req.path);
     if(fake.failAfterChange)throw new Error("wslfs_write_outcome_unknown");
     return {ok:true,restored:req.operation==="restore_created"};
    }
    if(req.operation==="write_existing"||req.operation==="restore_modified"){
     fake.files.set(req.path,req.content??"");
     if(fake.failAfterChange)throw new Error("wslfs_write_outcome_unknown");
     return {ok:true,restored:req.operation==="restore_modified",sha256:sha(req.content??"")};
    }
    if(req.operation==="modify_existing"){
     const count=old.split(req.query??"").length-1;
     if(!req.query||count===0)throw new Error("modify_not_found");
     const next=old.split(req.query).join(req.content??"");
     fake.files.set(req.path,next);
     if(fake.failAfterChange)throw new Error("wslfs_write_outcome_unknown");
     return {ok:true,sha256:sha(next),replacedOccurrences:count};
    }
    throw new Error("unknown_mock_mutation");
  }),
 };
});
vi.mock("../src/memory/file-audit.js",()=>({logFileAction:vi.fn(async()=>{})}));

const root="wsl://Ubuntu/home/coder/workspace/Hooshix";
const binding={uri:root,distro:"Ubuntu",linuxRoot:"/home/coder/workspace/Hooshix",
 label:"Hooshix",ownerWindowsRoot:"D:\\Users\\Coder\\owner-root"};
function as<T>(id:string,call:()=>T):T{
 return runWithTrustedInboundIdentity({
  principal:{id:id as never,permission:"DEVELOPER",origin:"http_oauth",scopes:[]},
  sessionId:("session-"+id) as never,
 },call);
}
describe("WSL native MCP mutation snapshot orchestration",()=>{
 let dir:string;
 beforeEach(()=>{
  fake.files.clear();fake.calls.length=0;fake.failAfterChange=false;
  dir=fs.mkdtempSync(path.join(os.tmpdir(),"wsl-mutation-tests-"));
  vi.stubEnv("HOOSHIX_DB_PATH",path.join(dir,"sqlite.db"));
  resetAgentDatabase();resetMigrationsFlag();
  as("alice",()=>persistWSLWorkspaceBinding(binding));
  __reloadWorkspaceStateForTests();
 });
 afterEach(()=>{
  resetAgentDatabase();resetMigrationsFlag();vi.unstubAllEnvs();
  fs.rmSync(dir,{recursive:true,force:true});
 });
 it("creates with an immutable absent snapshot and independently verifies the digest",async()=>{
  const result=await as("alice",()=>mutateWSLFile(root,"create_file",{path:"src/new.txt",content:"created"},"trace-create"));
  const backup=getStoredFileBackup(result.backupId as string)!;
  expect(result.created).toBe(true);
  expect(fake.files.get("src/new.txt")).toBe("created");
  expect(backup.previous_state).toBe("absent");
  expect(backup.post_mutation_state).toBe("present");
  expect(backup.post_mutation_revision).toBe(digest("created"));
  expect(fake.calls).toEqual([{operation:"create",path:"src/new.txt"}]);
 });
 it("write_file creates an absent file through atomic create, without an overwrite path",async()=>{
  const result=await as("alice",()=>mutateWSLFile(root,"write_file",{
    path:"src/new-by-write.txt",content:"new through write"
  },"trace-write-create"));
  expect(result.created).toBe(true);
  expect(result.previousState).toBe("absent");
  expect(fake.calls).toEqual([{operation:"create",path:"src/new-by-write.txt"}]);
  expect(getStoredFileBackup(result.backupId as string)?.post_mutation_state).toBe("present");
 });
 it("writes/modifies with durable original bytes, then restores the original version",async()=>{
  fake.files.set("src/modified.txt","hello hello");
  const change=await as("alice",()=>mutateWSLFile(root,"modify_file",{
    path:"src/modified.txt",search:"hello",replacement:"world"
  },"trace-modify"));
  expect(change.replacedOccurrences).toBe(2);
  const backup=getStoredFileBackup(change.backupId as string)!;
  expect(backup.content.toString("utf8")).toBe("hello hello");
  expect(backup.previous_revision).toBe(digest("hello hello"));
  expect(fake.files.get("src/modified.txt")).toBe("world world");
  const restored=await as("alice",()=>mutateWSLFile(root,"restore_file",{backupId:change.backupId},"trace-restore"));
  expect(restored.restored).toBe(true);
  expect(fake.files.get("src/modified.txt")).toBe("hello hello");
  expect(getStoredFileBackup(change.backupId as string)!.restored_at).toBeTruthy();
 });
 it("deletes with snapshot and later restores only the deleted bytes",async()=>{
  fake.files.set("src/gone.txt","recoverable");
  const deletion=await as("alice",()=>mutateWSLFile(root,"delete_file",{path:"src/gone.txt"},"trace-delete"));
  const backup=getStoredFileBackup(deletion.backupId as string)!;
  expect(backup.post_mutation_state).toBe("absent");
  expect(fake.files.has("src/gone.txt")).toBe(false);
  await as("alice",()=>mutateWSLFile(root,"restore_file",{backupId:deletion.backupId},"trace-restore"));
  expect(fake.files.get("src/gone.txt")).toBe("recoverable");
 });
 it("never auto-replays an unknown completed write or falsely confirms its postcondition",async()=>{
  fake.files.set("file.txt","original");
  fake.failAfterChange=true;
  await expect(as("alice",()=>mutateWSLFile(root,"write_file",{
    path:"file.txt",content:"new",ifMatchSha256:digest("original")
  },"trace-unknown"))).rejects.toThrow(/outcome_unknown/);
  expect(fake.files.get("file.txt")).toBe("new");
  expect(fake.calls).toHaveLength(1);
  const {withAgentDatabase}=await import("../src/core/memory/database/index.js");
  const count=withAgentDatabase(db=>db.prepare(
    "SELECT COUNT(*) AS count FROM file_backups WHERE post_mutation_state IS NULL").get() as {count:number});
  expect(count.count).toBe(1);
 });
 it("rejects a different principal and unknown idempotency without invoking Linux writes",async()=>{
  fake.files.set("src/private.txt","prior");
  await expect(as("bob",()=>mutateWSLFile(root,"write_file",{
   path:"src/private.txt",content:"overwrite"
  },"trace-deny"))).rejects.toThrow(/not_authorized|not_granted/);
  await expect(as("alice",()=>mutateWSLFile(root,"write_file",{
   path:"src/private.txt",content:"overwrite",idempotencyKey:"key1"
  },"trace-key"))).rejects.toThrow(/idempotency_receipt_not_implemented/);
  expect(fake.calls).toHaveLength(0);
  expect(fake.files.get("src/private.txt")).toBe("prior");
 });
});
