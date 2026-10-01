import fs from "node:fs";
import path from "node:path";
import {afterEach,describe,expect,it,vi} from "vitest";
import {createDisposableFixture,type DisposableFixture} from "../helpers/r0-disposable-fixtures.js";
import {addWorkspaceRoots,removeWorkspaceRoot,setActiveWorkspace} from "../../src/security/workspace-guard.js";
import {runWithPolicyApproval} from "../../src/core/governance/policy-decision-point.js";

const {execaMock}=vi.hoisted(()=>({execaMock:vi.fn()}));
vi.mock("execa",()=>({execa:execaMock}));
import {managePackage} from "../../src/services/package/package-service.js";

let fixture:DisposableFixture|undefined;
function setup():string {
  fixture=createDisposableFixture("r4-manifest");
  addWorkspaceRoots([fixture.root]);setActiveWorkspace(fixture.root);
  return fixture.root;
}
afterEach(()=>{
  execaMock.mockReset();
  setActiveWorkspace(process.cwd());
  if(fixture){try{removeWorkspaceRoot(fixture.root);}catch{/* test cleanup */}}
  fixture?.cleanup();fixture=undefined;
});

describe("R4.07 truthful manifest-only compensation",()=>{
  it("treats an interrupted package process as unknown without auto-restoring its snapshot",async()=>{
    const root=setup(),manifest=path.join(root,"package.json");
    fs.writeFileSync(manifest,'{"name":"baseline"}');
    execaMock.mockResolvedValueOnce({exitCode:1,stdout:"",stderr:"timed out",timedOut:true,isCanceled:false});
    await expect(runWithPolicyApproval("install_package",()=>managePackage({
      manager:"npm",action:"install",name:"fixture-package",cwd:root,correlationId:"r4-timeout"
    }))).rejects.toThrow(/outcome unknown/i);
    expect(fs.readFileSync(manifest,"utf8")).toBe('{"name":"baseline"}');
    const rows=(await import("../../src/core/memory/database/index.js")).withAgentDatabase(db=>
      db.prepare("SELECT status,restored_at FROM package_snapshots WHERE correlation_id='r4-timeout'").all()
    ) as Array<{status:string;restored_at:string|null}>;
    expect(rows).toEqual([{status:"outcome_unknown",restored_at:null}]);
  });
});
