import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { connectInProcessMcp } from "../helpers/in-process-mcp.js";
import { createTaskRuntimeService } from "../../src/core/runtime/composition-root.js";
import { createDisposableFixture, type DisposableFixture } from "../helpers/r0-disposable-fixtures.js";
import { addWorkspaceRoots, getWorkspaceRoot, listWorkspaceRoots, removeWorkspaceRoot, setActiveWorkspace } from "../../src/security/workspace-guard.js";

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
  it("rejects direct root-pool expansion but permits the same exact human-approved Task mutation",async()=>{
    previous=getWorkspaceRoot();
    expect(previous).toBeTruthy();
    fixture=createDisposableFixture("r2-approved-root");
    process.env.HOOSHIX_PERMISSION_LEVEL="DEVELOPER_MODE";
    const client=await connectInProcessMcp();
    try {
      const direct=await client.client.callTool({name:"add_workspace_roots",arguments:{paths:[fixture.root]}});
      expect(direct.isError).toBe(true);
      expect(listWorkspaceRoots().some(root=>root.path===fixture!.root)).toBe(false);
      const runtime=createTaskRuntimeService();
      const plan=runtime.create({title:"approve one disposable root",steps:[{
        action:"authorize one new root",tool:"add_workspace_roots",
        arguments:{paths:[fixture.root]},
      }]});
      const paused=await runtime.run(plan.id,0);
      expect(paused.status).toBe("pending_approval");
      const id=paused.approvalId!;
      expect(runtime.approve(id).approved).toBe(true);
      const result=await runtime.resume(id);
      expect(result.status).toBe("completed");
      expect(listWorkspaceRoots().some(root=>root.path===fixture!.root)).toBe(true);
      const switched=await client.client.callTool({name:"set_workspace",arguments:{path:fixture.root}});
      expect(switched.isError).not.toBe(true);
      expect(getWorkspaceRoot()).toBe(fixture.root);
      expect((await runtime.resume(id)).status).toBe("not_resumable");
    }finally{await client.close()}
  });
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