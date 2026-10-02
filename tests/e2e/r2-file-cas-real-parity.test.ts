import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { connectInProcessMcp, json } from "../helpers/in-process-mcp.js";
import { createDisposableFixture } from "../helpers/r0-disposable-fixtures.js";
import { addWorkspaceRoots, getWorkspaceRoot, removeWorkspaceRoot, setActiveWorkspace } from "../../src/security/workspace-guard.js";
const sha=(s:string)=>crypto.createHash("sha256").update(s).digest("hex");

describe("R2.08 actual MCP and durable Task file revision/idempotency parity",()=>{
  it("exposes a usable direct revision, rejects stale direct writes, and supports Task CAS templates",async()=>{
    const fixture=createDisposableFixture("r2-real-cas");
    const previous=getWorkspaceRoot();
    const target=path.join(fixture.root,"revision.txt");
    fs.writeFileSync(target,"alpha");
    addWorkspaceRoots([fixture.root]);
    setActiveWorkspace(fixture.root);
    const harness=await connectInProcessMcp();
    try{
      const raw=await harness.client.callTool({name:"read_file",arguments:{path:target,includeSha256:true}});
      expect(raw.isError).not.toBe(true);
      const direct=json(raw) as {content:string;sha256:string};
      expect(direct.sha256).toBe(sha("alpha"));
      expect(direct.content).toBe("alpha");
      const key=crypto.randomUUID();
      const first=json(await harness.client.callTool({name:"write_file",arguments:{path:target,content:"beta",ifMatchSha256:direct.sha256,idempotencyKey:key}})) as {backupId:string};
      expect(first.backupId).toBeTruthy();
      const replay=json(await harness.client.callTool({name:"write_file",arguments:{path:target,content:"beta",ifMatchSha256:direct.sha256,idempotencyKey:key}})) as {backupId:string};
      expect(replay.backupId).toBe(first.backupId);
      const stale=await harness.client.callTool({name:"write_file",arguments:{path:target,content:"overwritten",ifMatchSha256:direct.sha256}});
      expect(stale.isError).toBe(true);
      expect(fs.readFileSync(target,"utf8")).toBe("beta");
      const created=json(await harness.client.callTool({name:"task_create",arguments:{
        title:"disposable R2 file CAS",steps:[
          {action:"get current revision",tool:"read_file",arguments:{path:target,includeSha256:true}},
          {action:"write if unchanged",tool:"write_file",arguments:{path:target,content:"gamma",ifMatchSha256:"{{step1.output.sha256}}",idempotencyKey:crypto.randomUUID()},dependsOn:[1]},
        ],
      }})) as {id:string};
      expect(created.id).toBeTruthy();
      const run=json(await harness.client.callTool({name:"task_run",arguments:{taskId:created.id,maxRecovery:0}})) as {status:string};
      expect(run.status).toBe("completed");
      const plan=json(await harness.client.callTool({name:"task_get",arguments:{taskId:created.id}})) as {steps:Array<{output:any}>};
      expect(plan.steps[0]?.output).toMatchObject({sha256:sha("beta")});
      expect(plan.steps[1]?.output?.backupId).toBeTruthy();
      expect(fs.readFileSync(target,"utf8")).toBe("gamma");
      const modified=json(await harness.client.callTool({name:"modify_file",arguments:{path:target,search:"gamma",replacement:"delta",ifMatchSha256:sha("gamma")}})) as {backupId:string};
      expect(modified.backupId).toBeTruthy();
      const staleModify=await harness.client.callTool({name:"modify_file",arguments:{path:target,search:"delta",replacement:"unexpected",ifMatchSha256:sha("gamma")}});
      expect(staleModify.isError).toBe(true);
      expect(fs.readFileSync(target,"utf8")).toBe("delta");
      const taskModify=json(await harness.client.callTool({name:"task_create",arguments:{
        title:"disposable R2 Task modify CAS",steps:[
          {action:"read revision",tool:"read_file",arguments:{path:target,includeSha256:true}},
          {action:"modify if unchanged",tool:"modify_file",arguments:{path:target,search:"delta",replacement:"epsilon",ifMatchSha256:"{{step1.output.sha256}}"},dependsOn:[1]},
        ],
      }})) as {id:string};
      const modRun=json(await harness.client.callTool({name:"task_run",arguments:{taskId:taskModify.id,maxRecovery:0}})) as {status:string};
      expect(modRun.status).toBe("completed");
      expect(fs.readFileSync(target,"utf8")).toBe("epsilon");
    }finally{
      await harness.close();
      if(previous)setActiveWorkspace(previous);
      try{removeWorkspaceRoot(fixture.root)}catch{}
      fixture.cleanup();
    }
  },25000);
});
