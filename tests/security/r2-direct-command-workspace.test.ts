import {afterEach,describe,expect,it} from "vitest";
import {connectInProcessMcp,json} from "../helpers/in-process-mcp.js";
import {createDisposableFixture,type DisposableFixture} from "../helpers/r0-disposable-fixtures.js";
import {addWorkspaceRoots,getWorkspaceRoot,removeWorkspaceRoot,setActiveWorkspace} from "../../src/security/workspace-guard.js";

const priorPermission=process.env.HOOSHIX_PERMISSION_LEVEL;
const priorAutoApprove=process.env.HOOSHIX_DIRECT_AUTO_APPROVE;
let fixture:DisposableFixture|undefined;
let priorRoot:string|null=null;
afterEach(()=>{
  if(priorPermission===undefined)delete process.env.HOOSHIX_PERMISSION_LEVEL;
  else process.env.HOOSHIX_PERMISSION_LEVEL=priorPermission;
  if(priorAutoApprove===undefined)delete process.env.HOOSHIX_DIRECT_AUTO_APPROVE;
  else process.env.HOOSHIX_DIRECT_AUTO_APPROVE=priorAutoApprove;
  if(priorRoot)setActiveWorkspace(priorRoot);
  if(fixture){removeWorkspaceRoot(fixture.root);fixture.cleanup();}
  fixture=undefined;priorRoot=null;
});
describe("R2.09 direct command handler workspace contract",()=>{
  it("runs an auto-safe command against the selected temporary root, not process.cwd()",async()=>{
    priorRoot=getWorkspaceRoot();
    expect(priorRoot).toBeTruthy();
    fixture=createDisposableFixture("r2-cmd-root");
    addWorkspaceRoots([fixture.root]);
    setActiveWorkspace(fixture.root);
    process.env.HOOSHIX_PERMISSION_LEVEL="DEVELOPER_MODE";
    process.env.HOOSHIX_DIRECT_AUTO_APPROVE="0";
    const harness=await connectInProcessMcp();
    try{
      const raw=await harness.client.callTool({name:"execute_command",arguments:{
        command:"node",args:["--version"],
      }});
      expect(raw.isError,JSON.stringify(raw)).not.toBe(true);
      expect(json(raw)).toMatchObject({exitCode:0});
      expect((json(raw) as {stdout:string}).stdout).toMatch(/^v\d+/);
    }finally{await harness.close();}
  });
});
