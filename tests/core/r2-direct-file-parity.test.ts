import { describe,expect,it,vi } from "vitest";
import { registerReadFileTool } from "../../src/tools/filesystem/read-file.js";
import { registerWriteFileTool } from "../../src/tools/filesystem/write-file.js";
import { registerModifyFileTool } from "../../src/tools/filesystem/modify-file.js";
import { registerDeleteFileTool } from "../../src/tools/filesystem/delete-file.js";
import {
  readWorkspaceFile,writeWorkspaceFile,modifyWorkspaceFile,deleteWorkspaceFile,
} from "../../src/services/filesystem/filesystem-service.js";

vi.mock("../../src/services/filesystem/filesystem-service.js",()=>({
  readWorkspaceFile:vi.fn(),writeWorkspaceFile:vi.fn(),
  modifyWorkspaceFile:vi.fn(),deleteWorkspaceFile:vi.fn(),
}));
type Registration={schema:{parse(input:unknown):any};handle(input:any):Promise<any>};
function collect(){
  const all=new Map<string,Registration>();
  const server={registerTool(name:string,config:{inputSchema:{parse(input:unknown):unknown}},
    callback:(args:unknown)=>Promise<unknown>){
    all.set(name,{schema:config.inputSchema,handle:callback});
  }};
  registerReadFileTool(server as never);
  registerWriteFileTool(server as never);
  registerModifyFileTool(server as never);
  registerDeleteFileTool(server as never);
  return all;
}
describe("R2.08/R2.09 file schemas and retired unmediated callbacks",()=>{
  it("keeps includeSha256 in the MCP read schema; standalone callback cannot read",async()=>{
    const reg=collect().get("read_file")!;
    expect(reg.schema.parse({path:"a",includeSha256:true})).toMatchObject({
      path:"a",includeSha256:true,
    });
    await expect(reg.handle({path:"a"})).rejects.toThrow("r2_legacy_direct_callback_retired");
    expect(readWorkspaceFile).not.toHaveBeenCalled();
  });
  it("keeps exact write revision and idempotency arguments without a standalone effect",async()=>{
    const reg=collect().get("write_file")!;
    const args={path:"a",content:"changed",ifMatchSha256:"b".repeat(64),idempotencyKey:"id-1"};
    expect(reg.schema.parse(args)).toMatchObject(args);
    expect(()=>reg.schema.parse({...args,ifMatchSha256:"invalid"})).toThrow();
    expect(()=>reg.schema.parse({...args,idempotencyKey:""})).toThrow();
    await expect(reg.handle(args)).rejects.toThrow("r2_legacy_direct_callback_retired");
    expect(writeWorkspaceFile).not.toHaveBeenCalled();
  });
  it("keeps modify/delete CAS and replay keys, never invoking a standalone adapter",async()=>{
    const r=collect();
    const modify=r.get("modify_file")!,del=r.get("delete_file")!;
    const modification={path:"a",search:"old",replacement:"new",ifMatchSha256:"c".repeat(64)};
    const deletion={path:"a",idempotencyKey:"delete-1"};
    expect(modify.schema.parse(modification)).toMatchObject(modification);
    expect(del.schema.parse(deletion)).toMatchObject(deletion);
    await expect(modify.handle(modification)).rejects.toThrow("r2_legacy_direct_callback_retired");
    await expect(del.handle(deletion)).rejects.toThrow("r2_legacy_direct_callback_retired");
    expect(modifyWorkspaceFile).not.toHaveBeenCalled();
    expect(deleteWorkspaceFile).not.toHaveBeenCalled();
  });
});
