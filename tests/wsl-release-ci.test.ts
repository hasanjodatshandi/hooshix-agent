import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const root=process.cwd();
const node=process.execPath;
const audit="scripts/audit-wsl-release-candidate.mjs";
function run(extra:string[]=[],environment:Record<string,string>={}){
 return spawnSync(node,[audit,...extra],{
  cwd:root,encoding:"utf8",timeout:30000,maxBuffer:8*1024*1024,
  env:{...process.env,...environment}
 });
}
describe("WSL release provenance and CI fail-closed gates",()=>{
 it("derives both runner pins from package.json and preserves frozen lockfile verification",()=>{
  const pkg=JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8")) as {packageManager:string};
  const ci=fs.readFileSync(path.join(root,".github/workflows/ci.yml"),"utf8");
  expect(pkg.packageManager).toBe("pnpm@12.14.0");
  expect(ci).toContain("packageManager.split");
  expect(ci).toContain("Get-Content package.json");
  expect(ci).toContain('corepack prepare "pnpm@$expected" --activate');
  expect(ci).not.toContain("pnpm@11.24.0");
  expect(ci).not.toContain('"11.24.0"');
  expect(ci).toContain("pnpm install --frozen-lockfile --registry=https://registry.npmjs.org/");
  expect(ci).toContain("corepack pnpm install --frozen-lockfile --registry=https://registry.npmjs.org/");
  expect(ci).toContain("pnpm audit --prod --audit-level=high");
 });
 it("runs read-only audit and correctly reports dirty or clean source",()=>{
  const result=run();
  expect(result.error).toBeUndefined();
  const auditResult=JSON.parse(result.stdout) as {
    verdict:string;productionApproval:boolean;
    source:{clean:boolean;changedPathCount:number;groups:Record<string,Array<{path:string}>>};
    blockers:string[];ciPackageManagerPinAligned:boolean;
  };
  expect(auditResult.ciPackageManagerPinAligned).toBe(true);
  expect(auditResult.productionApproval).toBe(false);
  expect(auditResult.source.changedPathCount).toBeGreaterThanOrEqual(0);
  if(auditResult.source.clean){
    expect(result.status).toBe(0);
    expect(auditResult.verdict).toBe("LOCAL_SOURCE_PROVENANCE_GATE_PASS");
  }else{
    expect(result.status).toBe(1);
    expect(auditResult.verdict).toBe("NO_GO");
    expect(auditResult.blockers).toContain("DIRTY_SOURCE_WITH_UNCOMMITTED_CHANGES");
  }
  for(const group of Object.values(auditResult.source.groups)){
    for(const item of group){
      expect(typeof item.path).toBe("string");
      expect(item.path.length).toBeGreaterThan(0);
    }
  }
 });
 it("denies installer verification from paths outside the isolated build folder",()=>{
  const result=run(["--installer",path.join(root,"package.json")]);
  expect(result.status).toBe(2);
  expect(result.stderr).toMatch(/staging directory/);
 });
 it("accepts a checksum-verified installer under the CI runner temp root",()=>{
   const dir=fs.mkdtempSync(path.join(os.tmpdir(),"hooshix-release-audit-"));
   try{
     const installer=path.join(dir,"staging.exe");
     const bytes=Buffer.from("CI staging fixture, not a real installer");
     const digest=crypto.createHash("sha256").update(bytes).digest("hex");
     fs.writeFileSync(installer,bytes);
     fs.writeFileSync(installer+".sha256",digest+"  staging.exe\\n");
     const accepted=run(["--installer",installer],{RUNNER_TEMP:dir});
     const report=JSON.parse(accepted.stdout);
     expect(report.installer.integrity).toBe("PASS");
     expect(report.productionApproval).toBe(false);
     expect(accepted.status).toBe(report.source.clean?0:1);
     fs.writeFileSync(installer+".sha256","f".repeat(64)+"  staging.exe\\n");
     const rejected=run(["--installer",installer],{RUNNER_TEMP:dir});
     expect(rejected.status).toBe(1);
     expect(JSON.parse(rejected.stdout).blockers)
       .toContain("STAGING_INSTALLER_INTEGRITY_NOT_VERIFIED");
   }finally{fs.rmSync(dir,{recursive:true,force:true});}
 });
 it("requires source provenance and integrity gate in CI before keeping the installer",()=>{
  const workflow=fs.readFileSync(path.join(root,".github/workflows/ci.yml"),"utf8");
  expect(workflow).toContain("node scripts/audit-wsl-release-candidate.mjs");
  expect(workflow).toContain("node scripts/audit-wsl-release-candidate.mjs --installer $target");
  for(const script of ["enroll-wsl-files.ps1","enroll-wsl-file-writes.ps1",
    "enroll-wsl-git-writes.ps1","preflight-wsl-enrollment.ps1"]){
    expect(workflow).toContain(script);
  }
  expect(workflow).toContain("TestStagedInstallerPayload");
 });
});
