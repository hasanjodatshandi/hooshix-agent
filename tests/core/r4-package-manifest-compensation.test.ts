import fs from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {afterEach,describe,expect,it,vi} from "vitest";
import {createDisposableFixture,type DisposableFixture} from "../helpers/r0-disposable-fixtures.js";
import {addWorkspaceRoots,removeWorkspaceRoot,setActiveWorkspace} from "../../src/security/workspace-guard.js";
import {runWithPolicyApproval} from "../../src/core/governance/policy-decision-point.js";
import {insertPackageSnapshot,updateStoredPackageSnapshot,findPackageSnapshot} from "../../src/adapters/outbound/persistence/sqlite/repositories/package-snapshot.adapter.js";

const {execaMock}=vi.hoisted(()=>({execaMock:vi.fn()}));
vi.mock("execa",()=>({execa:execaMock}));
import {restorePackageManifest,managePackage} from "../../src/services/package/package-service.js";

let fixture:DisposableFixture|undefined;
function setup():string {
  fixture=createDisposableFixture("r4-manifest");
  addWorkspaceRoots([fixture.root]);setActiveWorkspace(fixture.root);
  return fixture.root;
}
function create(manager:string,files:unknown[],status:"committed"|"created"="committed"){
  const id=randomUUID(),root=fixture!.root;
  insertPackageSnapshot({id,correlationId:"r4-manifest",manager,action:"install",packageName:"fixture-package",cwd:root,snapshot:{files}});
  if(status==="committed")updateStoredPackageSnapshot(id,"committed");
  return id;
}
async function restore(id:string){return runWithPolicyApproval("package_restore",()=>restorePackageManifest(id));}
afterEach(()=>{
  execaMock.mockReset();
  setActiveWorkspace(process.cwd());
  if(fixture){try{removeWorkspaceRoot(fixture.root);}catch{/* test cleanup */}}
  fixture?.cleanup();fixture=undefined;
});

describe("R4.07 truthful manifest-only compensation",()=>{
  it("restores exact captured manifest bytes while explicitly refusing to claim installed-state rollback",async()=>{
    const root=setup(),file=path.join(root,"package.json"),marker=path.join(root,"installed.marker");
    fs.writeFileSync(file,'{"name":"before"}');
    fs.writeFileSync(marker,"installed-new-version");
    const id=create("npm",[{path:"package.json",existed:true,content:fs.readFileSync(file).toString("base64")}]);
    fs.writeFileSync(file,'{"name":"after"}');
    const result=await restore(id);
    expect(result).toMatchObject({kind:"manifest_restored",restored:false,manifestOnly:true,
      environmentReconciliationRequired:true,verifiedFiles:[file]});
    expect(fs.readFileSync(file,"utf8")).toBe('{"name":"before"}');
    expect(fs.readFileSync(marker,"utf8")).toBe("installed-new-version");
    expect(findPackageSnapshot(id)?.status).toBe("manifest_restored");
    await expect(restore(id)).rejects.toThrow(/ALREADY_RESTORED/);
  });
  it("restores previously absent manifest to absence but not installed environment",async()=>{
    const root=setup(),file=path.join(root,"pnpm-lock.yaml");
    const id=create("pnpm",[{path:"pnpm-lock.yaml",existed:false}]);
    fs.writeFileSync(file,"later manifest");
    const result=await restore(id);
    expect(result.kind).toBe("manifest_restored");
    expect(fs.existsSync(file)).toBe(false);
  });
  it("reports unsupported compensation for a system manager without touching installed state",async()=>{
    const root=setup(),marker=path.join(root,"installed.marker");
    fs.writeFileSync(marker,"unchanged");
    const id=create("winget",[]);
    const result=await restore(id);
    expect(result).toMatchObject({kind:"manifest_restore_unsupported",restored:false,manifestOnly:true,
      environmentReconciliationRequired:true,verifiedFiles:[]});
    expect(fs.readFileSync(marker,"utf8")).toBe("unchanged");
    expect(findPackageSnapshot(id)?.status).toBe("environment_reconciliation_required");
  });
  it("rejects a mixed snapshot with traversal before changing even its first valid manifest",async()=>{
    const root=setup(),file=path.join(root,"package.json"),outside=path.join(root,"outside.marker");
    fs.writeFileSync(file,"current");fs.writeFileSync(outside,"preserve");
    const id=create("npm",[
      {path:"package.json",existed:true,content:Buffer.from("older").toString("base64")},
      {path:"../outside.marker",existed:false}
    ]);
    await expect(restore(id)).rejects.toThrow(/PACKAGE_MANIFEST_SNAPSHOT_INVALID/);
    expect(fs.readFileSync(file,"utf8")).toBe("current");
    expect(fs.readFileSync(outside,"utf8")).toBe("preserve");
  });
  it("rejects symlink substitution without editing its destination",async()=>{
    const root=setup(),target=path.join(root,"actual"),manifest=path.join(root,"package.json");
    fs.writeFileSync(target,"preserve");
    try{fs.symlinkSync(target,manifest,"file");}catch{return;}
    const id=create("npm",[{path:"package.json",existed:true,content:Buffer.from("older").toString("base64")}]);
    await expect(restore(id)).rejects.toThrow(/UNSAFE_TARGET|outside/i);
    expect(fs.readFileSync(target,"utf8")).toBe("preserve");
  });
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
