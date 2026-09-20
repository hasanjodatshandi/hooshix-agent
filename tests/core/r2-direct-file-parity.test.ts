import { describe, expect, it, vi } from "vitest";
import { registerReadFileTool } from "../../src/tools/filesystem/read-file.js";
import { registerWriteFileTool } from "../../src/tools/filesystem/write-file.js";
import { registerModifyFileTool } from "../../src/tools/filesystem/modify-file.js";
import { registerDeleteFileTool } from "../../src/tools/filesystem/delete-file.js";
import { readWorkspaceFile, writeWorkspaceFile, modifyWorkspaceFile, deleteWorkspaceFile } from "../../src/services/filesystem/filesystem-service.js";
vi.mock("../../src/services/filesystem/filesystem-service.js", () => ({
  readWorkspaceFile: vi.fn(async () => ({content:"fixture",sha256:"a".repeat(64)})),
  writeWorkspaceFile: vi.fn(async () => ({backupId:"write-backup"})),
  modifyWorkspaceFile: vi.fn(async () => ({backupId:"modify-backup"})),
  deleteWorkspaceFile: vi.fn(async () => ({backupId:"delete-backup"})),
}));
vi.mock("../../src/core/memory/tool-audit.js", () => ({
  auditToolCall: vi.fn(async (_tool:unknown,_trace:unknown,_task:unknown,run:()=>unknown)=>run()),
}));
type Registration={schema:{parse(input:unknown):unknown};handle(input:any):Promise<any>};
function collect() {
  const all=new Map<string,Registration>();
  const fake={registerTool(name:string, config:any, handle:(input:unknown)=>Promise<unknown>){
    all.set(name,{schema:config.inputSchema,handle});
  }};
  registerReadFileTool(fake as never);
  registerWriteFileTool(fake as never);
  registerModifyFileTool(fake as never);
  registerDeleteFileTool(fake as never);
  return all;
}
describe("R2.08 direct file API matches governed Task CAS/idempotency arguments",()=>{
  it("exposes a stable read revision and routes includeSha256 to the shared file service",async()=>{
    const reg=collect().get("read_file")!;
    const args=reg.schema.parse({path:"a",includeSha256:true});
    const result=await reg.handle(args);
    expect(readWorkspaceFile).toHaveBeenCalledWith("a",expect.any(String),{includeSha256:true});
    expect(result).toMatchObject({text:"fixture",sha256:"a".repeat(64)});
  });
  it("validates SHA shape and carries write CAS/idempotency unchanged",async()=>{
    const reg=collect().get("write_file")!;
    const args=reg.schema.parse({path:"a",content:"changed",ifMatchSha256:"b".repeat(64),idempotencyKey:"id-1"});
    await reg.handle(args);
    expect(writeWorkspaceFile).toHaveBeenCalledWith("a","changed",expect.any(String),{ifMatchSha256:"b".repeat(64),idempotencyKey:"id-1"});
    expect(()=>reg.schema.parse({path:"a",content:"x",ifMatchSha256:"invalid"})).toThrow();
    expect(()=>reg.schema.parse({path:"a",content:"x",idempotencyKey:""})).toThrow();
  });
  it("routes modify preconditions and delete idempotency keys",async()=>{
    const reg=collect();
    const modified=reg.get("modify_file")!;
    await modified.handle(modified.schema.parse({path:"a",search:"old",replacement:"new",ifMatchSha256:"c".repeat(64)}));
    expect(modifyWorkspaceFile).toHaveBeenCalledWith("a","old","new",expect.any(String),{ifMatchSha256:"c".repeat(64)});
    const deleted=reg.get("delete_file")!;
    await deleted.handle(deleted.schema.parse({path:"a",idempotencyKey:"delete-1"}));
    expect(deleteWorkspaceFile).toHaveBeenCalledWith("a",expect.any(String),{idempotencyKey:"delete-1"});
  });
});
