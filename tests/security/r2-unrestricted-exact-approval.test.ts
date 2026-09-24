import fs from "node:fs";
import path from "node:path";
import {afterEach,describe,expect,it} from "vitest";
import {createDisposableFixture,type DisposableFixture} from "../helpers/r0-disposable-fixtures.js";
import {createTaskRuntimeService} from "../../src/core/runtime/composition-root.js";
import {getTaskPlan,saveTaskPlan} from "../../src/core/memory/task-repository.js";
import {getApprovalRequest} from "../../src/core/governance/approval-memory.js";
import {withAgentDatabase} from "../../src/core/memory/database/index.js";
import {connectInProcessMcp} from "../helpers/in-process-mcp.js";
import {addWorkspaceRoots,getWorkspaceRoot,isUnrestrictedMode,
  removeWorkspaceRoot,seedUnrestrictedMode,setActiveWorkspace} from "../../src/security/workspace-guard.js";

const initialPermission=process.env.HOOSHIX_PERMISSION_LEVEL;
const initialAllow=process.env.HOOSHIX_UNRESTRICTED;
let allowed:DisposableFixture|undefined;
let outside:DisposableFixture|undefined;
let priorRoot:string|null=null;
let priorUnrestricted=false;

afterEach(()=>{
  if(initialPermission===undefined)delete process.env.HOOSHIX_PERMISSION_LEVEL;
  else process.env.HOOSHIX_PERMISSION_LEVEL=initialPermission;
  if(initialAllow===undefined)delete process.env.HOOSHIX_UNRESTRICTED;
  else process.env.HOOSHIX_UNRESTRICTED=initialAllow;
  seedUnrestrictedMode(priorUnrestricted);
  if(priorRoot)setActiveWorkspace(priorRoot);
  if(allowed){try{removeWorkspaceRoot(allowed.root)}catch{};allowed.cleanup();}
  outside?.cleanup();
  allowed=undefined;outside=undefined;priorRoot=null;
});
function prepare(){
  priorRoot=getWorkspaceRoot();
  priorUnrestricted=isUnrestrictedMode();
  process.env.HOOSHIX_PERMISSION_LEVEL="ADMIN_MODE";
  process.env.HOOSHIX_UNRESTRICTED="1";
  seedUnrestrictedMode(false);
  allowed=createDisposableFixture("r2-allow-root");
  outside=createDisposableFixture("r2-outside");
  addWorkspaceRoots([allowed.root]);
  setActiveWorkspace(allowed.root);
  const target=path.join(outside.root,"approved.txt");
  fs.writeFileSync(target,"approved-fixture-only");
  return target;
}
describe("R2.05 exact, per-effect unrestricted access",()=>{
  it("never elevates direct MCP filesystem scope merely from a server opt-in",async()=>{
    const target=prepare();
    expect(isUnrestrictedMode()).toBe(false);
    const client=await connectInProcessMcp();
    try{
      const forbidden=await client.client.callTool({name:"read_file",arguments:{path:target}});
      expect(forbidden.isError).toBe(true);
      const spoofed=await client.client.callTool({name:"read_file",arguments:{path:target,unrestricted:true}});
      expect(spoofed.isError).toBe(true);
    }finally{await client.close();}
    expect(isUnrestrictedMode()).toBe(false);
  });
  it("only an ADMIN Task's exact human-approved file read may access outside its active root",async()=>{
    const target=prepare();
    const runtime=createTaskRuntimeService();
    const plan=runtime.create({title:"one authorized out-of-root fixture read",
      steps:[{action:"read one explicitly approved fixture",tool:"read_file",
        arguments:{path:target,unrestricted:true}}]});
    expect(plan.executionContext?.unrestricted).toBe(false);
    const paused=await runtime.run(plan.id,0);
    expect(paused.status,JSON.stringify({state:paused.status,steps:paused.plan.steps.map(s=>({status:s.status,error:s.error,errorType:s.errorType}))})).toBe("pending_approval");
    expect(paused.plan.steps[0].output).toBeUndefined();
    const id=paused.approvalId!;
    expect(runtime.approve(id).approved).toBe(true);
    const resumed=await runtime.resume(id);
    expect(resumed.status).toBe("completed");
    expect(JSON.stringify(resumed.plan.steps[0].output)).toContain("approved-fixture-only");
    expect(isUnrestrictedMode()).toBe(false);
    const client=await connectInProcessMcp();
    try{
      const forbidden=await client.client.callTool({name:"read_file",arguments:{path:target}});
      expect(forbidden.isError).toBe(true);
    }finally{await client.close();}
    const replay=await runtime.resume(id);
    expect(replay.status).toBe("not_resumable");
  });
  it("authorizes a single out-of-root write only through the bound ADMIN Task, never through direct MCP",async()=>{
    prepare();
    const target=path.join(outside!.root,"approved-write.txt");
    const client=await connectInProcessMcp();
    try {
      const direct=await client.client.callTool({name:"write_file",arguments:{
        path:target,content:"unapproved",unrestricted:true,
      }});
      expect(direct.isError).toBe(true);
      expect(fs.existsSync(target)).toBe(false);
    }finally{await client.close();}
    const runtime=createTaskRuntimeService();
    const plan=runtime.create({title:"one exact outside write",steps:[{
      action:"write one marker-protected outside file",tool:"write_file",
      arguments:{path:target,content:"approved-once",unrestricted:true},
    }]});
    const paused=await runtime.run(plan.id,0);
    expect(paused.status).toBe("pending_approval");
    const id=paused.approvalId!;
    expect(fs.existsSync(target)).toBe(false);
    expect(runtime.approve(id).approved).toBe(true);
    const result=await runtime.resume(id);
    expect(result.status).toBe("completed");
    expect(fs.readFileSync(target,"utf8")).toBe("approved-once");
    const securityAudit=withAgentDatabase(db=>db.prepare(
      "SELECT reason FROM decisions WHERE action=? AND reason LIKE ? ORDER BY rowid DESC LIMIT 1"
    ).get("r2_security:approved_unrestricted_effect_executed",`%task=${plan.id};step=1;approval=${id}%`) as {reason:string}|undefined);
    expect(securityAudit?.reason).toContain(`task=${plan.id};step=1;approval=${id}`);
    expect(isUnrestrictedMode()).toBe(false);
    expect((await runtime.resume(id)).status).toBe("not_resumable");
  });
  it("refuses a human-approved unrestricted effect when the server allow flag is off",async()=>{
    const target=prepare();
    process.env.HOOSHIX_UNRESTRICTED="0";
    const runtime=createTaskRuntimeService();
    const plan=runtime.create({title:"deny unrestricted without server opt-in",
      steps:[{action:"read outside root without server allow",tool:"read_file",
        arguments:{path:target,unrestricted:true}}]});
    const pending=await runtime.run(plan.id,0);
    expect(pending.status).toBe("pending_approval");
    expect(runtime.approve(pending.approvalId!).approved).toBe(true);
    const denied=await runtime.resume(pending.approvalId!);
    expect(denied.status).toBe("failed");
    expect(denied.plan.steps[0].status).not.toBe("completed");
    expect(isUnrestrictedMode()).toBe(false);
  });
  it("refuses out-of-root access below ADMIN even when a Task step is human-approved",async()=>{
    const target=prepare();
    const runtime=createTaskRuntimeService();
    const plan=runtime.create({title:"deny nonadmin unrestricted",
      steps:[{action:"unapproved out-of-root read",tool:"read_file",
        arguments:{path:target,unrestricted:true}}]});
    process.env.HOOSHIX_PERMISSION_LEVEL="DEVELOPER_MODE";
    const paused=await runtime.run(plan.id,0);
    expect(paused.status,JSON.stringify({state:paused.status,steps:paused.plan.steps.map(s=>({status:s.status,error:s.error,errorType:s.errorType}))})).toBe("pending_approval");
    expect(runtime.approve(paused.approvalId!).approved).toBe(true);
    const denied=await runtime.resume(paused.approvalId!);
    expect(denied.status).toBe("failed");
    expect(denied.plan.steps[0].status).not.toBe("completed");
    expect(isUnrestrictedMode()).toBe(false);
  });
  it("rejects a changed approved target before claim, without reading a second out-of-root file",async()=>{
    const target=prepare();
    const changed=path.join(outside!.root,"other-target.txt");
    fs.writeFileSync(changed,"never-read-this");
    const runtime=createTaskRuntimeService();
    const plan=runtime.create({title:"exact path grant only",steps:[{
      action:"read one exact outside target",tool:"read_file",arguments:{path:target,unrestricted:true},
    }]});
    const paused=await runtime.run(plan.id,0);
    expect(paused.status).toBe("pending_approval");
    const approvalId=paused.approvalId!;
    expect(runtime.approve(approvalId).approved).toBe(true);
    const mutated=getTaskPlan(plan.id)!;
    mutated.steps[0].arguments={path:changed,unrestricted:true};
    saveTaskPlan(mutated,mutated.state,mutated.correlationId);
    expect((await runtime.resume(approvalId)).status).toBe("not_resumable");
    expect(getApprovalRequest(approvalId)?.status).toBe("approved");
    expect(isUnrestrictedMode()).toBe(false);
  });

});