import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { runWithTrustedInboundIdentity } from "../src/core/runtime/r2-trusted-inbound-identity.js";
import { resetAgentDatabase, resetMigrationsFlag } from "../src/core/memory/database/index.js";
import { getWSLWorkspaceBinding, persistWSLWorkspaceBinding, revokeWSLWorkspaceBinding } from "../src/security/wsl-workspace-binding.js";
import { __reloadWorkspaceStateForTests, listWorkspaceRoots, removeWorkspaceRoot, getWorkspaceRoot } from "../src/security/workspace-guard.js";
import { resolveProjectSelector } from "../src/security/project-handles.js";

const uri = "wsl://Ubuntu/home/coder/workspace/Hooshix";
const fixture = {
  uri, distro:"Ubuntu", linuxRoot:"/home/coder/workspace/Hooshix",
  label:"Hooshix", ownerWindowsRoot:"D:\\Users\\Coder\\owner-root"
};
const alice = "wsl-principal-alice";
const bob = "wsl-principal-bob";
function as<T>(id:string, cb:()=>T):T {
 return runWithTrustedInboundIdentity({
   principal:{id:id as never,permission:"DEVELOPER",origin:"http_oauth",scopes:[]},
   sessionId:("session-"+id) as never,
 },cb);
}
describe("WSL native workspace authorization binds the MCP principal",()=>{
 let dir:string;
 beforeEach(()=>{
   dir=fs.mkdtempSync(path.join(os.tmpdir(),"hooshix-wsl-principal-"));
   vi.stubEnv("HOOSHIX_DB_PATH",path.join(dir,"isolated-agent.db"));
   resetAgentDatabase();
   resetMigrationsFlag();
 });
 afterEach(()=>{
   resetAgentDatabase();
   resetMigrationsFlag();
   vi.unstubAllEnvs();
   fs.rmSync(dir,{recursive:true,force:true});
 });
 it("does not disclose or open another principal's WSL workspace",()=>{
   as(alice,()=>persistWSLWorkspaceBinding(fixture));
   __reloadWorkspaceStateForTests();
   expect(as(alice,()=>getWSLWorkspaceBinding(uri)?.uri)).toBe(uri);
   expect(as(bob,()=>getWSLWorkspaceBinding(uri))).toBeNull();
   expect(as(bob,()=>listWorkspaceRoots().some(x=>x.path===uri))).toBe(false);
   expect(as(bob,()=>getWorkspaceRoot())).toBeNull();
   expect(()=>as(bob,()=>resolveProjectSelector(uri))).toThrow(/project_not_allowed/);
   expect(as(bob,()=>removeWorkspaceRoot(uri))).toBe(false);
   expect(as(alice,()=>getWSLWorkspaceBinding(uri)?.uri)).toBe(uri);
 });
 it("rejects root takeover by another principal and preserves owner approval",()=>{
   as(alice,()=>persistWSLWorkspaceBinding(fixture));
   expect(()=>as(bob,()=>persistWSLWorkspaceBinding(fixture)))
     .toThrow(/wsl_workspace_binding_change_requires_revocation/);
   expect(()=>as(bob,()=>revokeWSLWorkspaceBinding(uri)))
     .toThrow(/wsl_workspace_binding_not_owned_by_principal/);
   expect(as(alice,()=>getWSLWorkspaceBinding(uri)?.ownerWindowsRoot))
     .toBe(fixture.ownerWindowsRoot);
 });
});