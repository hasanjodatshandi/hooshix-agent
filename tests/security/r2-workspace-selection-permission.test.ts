import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { connectInProcessMcp } from "../helpers/in-process-mcp.js";
import { createDisposableFixture, type DisposableFixture } from "../helpers/r0-disposable-fixtures.js";
import { addWorkspaceRoots, getWorkspaceRoot, removeWorkspaceRoot, setActiveWorkspace } from "../../src/security/workspace-guard.js";

const priorPermission=process.env.HOOSHIX_PERMISSION_LEVEL;
let fixture:DisposableFixture|undefined, previous:string|null=null;
afterEach(()=>{
  if(priorPermission===undefined)delete process.env.HOOSHIX_PERMISSION_LEVEL;
  else process.env.HOOSHIX_PERMISSION_LEVEL=priorPermission;
  if(previous)setActiveWorkspace(previous);
  if(fixture){try{removeWorkspaceRoot(fixture.root)}catch{};fixture.cleanup()}
  fixture=undefined;previous=null;
});
describe("R2.04 direct workspace selection authority",()=>{
  it("blocks a READ_ONLY MCP principal selecting any other pre-authorized root without changing state",async()=>{
    fixture=createDisposableFixture("r2-ws-selector");
    previous=getWorkspaceRoot();
    fs.writeFileSync(path.join(fixture.root,"proof.txt"),"disposable only");
    addWorkspaceRoots([fixture.root]);
    const client=await connectInProcessMcp();
    try{
      process.env.HOOSHIX_PERMISSION_LEVEL="READ_ONLY";
      const before=getWorkspaceRoot();
      const response=await client.client.callTool({name:"set_workspace",arguments:{path:fixture.root}});
      expect(response).toMatchObject({isError:true});
      expect(getWorkspaceRoot()).toBe(before);
      expect(JSON.stringify(response)).toMatch(/permission|access denied|requires/i);
    }finally{await client.close()}
  });
});
