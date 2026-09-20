import {describe,expect,it} from "vitest";
import {createAuthorizationService} from "../../src/application/services/authorization-service.js";
import {getOperationDescriptor} from "../../src/application/services/operation-catalog.js";
import {captureWorkspaceScope} from "../../src/domain/workspace/workspace-scope.js";
import type {PrincipalId,SessionId} from "../../src/domain/shared/ids.js";
import type {Principal} from "../../src/domain/auth/principal.js";
const owner="auth-owner" as PrincipalId,session="auth-session" as SessionId;
const workspace=captureWorkspaceScope({principalId:owner,sessionId:session,root:"/workspace",allowedRoots:["/workspace"],unrestricted:false,capturedAt:"2026-09-20T00:00:00Z"});
const local=(permission:Principal["permission"]="DEVELOPER"):Principal=>({id:owner,permission,origin:"local_stdio",scopes:[]});
function auth(serverCeiling:Principal["permission"]="ADMIN",allowUnrestricted=false){return createAuthorizationService({serverCeiling,allowUnrestricted});}
function descriptor(name:string){const x=getOperationDescriptor(name);if(!x)throw Error("bad fixture");return x;}
describe("R2.03 effective authorization with explicit principal/server ceilings",()=>{
 it("denies any operation above server ceiling or principal permission",()=>{
   const tool=descriptor("execute_command");
   expect(auth("READ").decide({principal:local("ADMIN"),descriptor:tool,scope:workspace})).toMatchObject({kind:"blocked",reason:"server_permission_ceiling"});
   expect(auth().decide({principal:local("PROJECT_ACCESS"),descriptor:tool,scope:workspace})).toMatchObject({kind:"blocked",reason:"principal_permission_insufficient"});
   expect(auth().decide({principal:local("READ"),descriptor:descriptor("read_file"),scope:workspace})).toEqual({kind:"allowed"});
 });
 it("requires explicitly established stdio or OAuth identity; HTTP scopes only reduce authority",()=>{
   const noOrigin:Principal={id:owner,permission:"ADMIN",scopes:[]};
   expect(auth().decide({principal:noOrigin,descriptor:descriptor("read_file"),scope:workspace}).kind).toBe("blocked");
   const http=(scopes:string[]):Principal=>({id:owner,permission:"ADMIN",origin:"http_oauth",scopes});
   expect(auth().decide({principal:http([]),descriptor:descriptor("read_file"),scope:workspace}).kind).toBe("blocked");
   expect(auth().decide({principal:http(["hooshix:read"]),descriptor:descriptor("read_file"),scope:workspace})).toEqual({kind:"allowed"});
   expect(auth().decide({principal:http(["hooshix:read"]),descriptor:descriptor("write_file"),scope:workspace}).kind).toBe("blocked");
   expect(auth().decide({principal:http(["hooshix:project:write"]),descriptor:descriptor("write_file"),scope:workspace}).kind).toBe("approval_required");
   expect(auth().decide({principal:http(["hooshix:read"]),descriptor:descriptor("agent_metrics"),scope:workspace}).kind).toBe("blocked");
   expect(auth().decide({principal:http(["hooshix:monitoring:read"]),descriptor:descriptor("agent_metrics"),scope:workspace})).toEqual({kind:"allowed"});
 });
 it("blocks cross-principal Task scope and a missing workspace without performing the operation",()=>{
   expect(auth().decide({principal:{...local(),id:"forged" as PrincipalId},descriptor:descriptor("read_file"),scope:workspace}).kind).toBe("blocked");
   expect(auth().decide({principal:local(),descriptor:descriptor("read_file"),scope:{...workspace,root:null}}).kind).toBe("blocked");
   expect(auth().decide({principal:local("READ"),descriptor:descriptor("get_workspace"),scope:{...workspace,root:null}})).toEqual({kind:"allowed"});
 });
 it("requires a server flag and ADMIN for unrestricted even when file descriptor is read-only",()=>{
   const unrestricted=captureWorkspaceScope({...workspace,unrestricted:true});
   expect(auth("ADMIN",false).decide({principal:local("ADMIN"),descriptor:descriptor("read_file"),scope:unrestricted}).kind).toBe("blocked");
   expect(auth("ADMIN",true).decide({principal:local("DEVELOPER"),descriptor:descriptor("read_file"),scope:unrestricted}).kind).toBe("blocked");
   expect(auth("ADMIN",true).decide({principal:local("ADMIN"),descriptor:descriptor("read_file"),scope:unrestricted}))
     .toMatchObject({kind:"approval_required",reason:"unrestricted_exact_task_approval_required"});
   expect(auth("ADMIN",true).decide({principal:local("ADMIN"),descriptor:descriptor("read_file"),scope:unrestricted,approvalVerified:true}))
     .toEqual({kind:"allowed"});
   expect(auth("ADMIN",true).decide({
     principal:{...local("ADMIN"),origin:"http_oauth",scopes:["hooshix:read"]},
     descriptor:descriptor("read_file"),scope:unrestricted,approvalVerified:true,
   })).toMatchObject({kind:"blocked",reason:"unrestricted_requires_admin_oauth_scope"});
 });
 it("denies a forged read-only descriptor bearing a mutation tool id",()=>{
   const real=descriptor("delete_file");
   const forged={...real,requiredPermission:"READ" as const,effect:"read_only" as const,approval:"never" as const,risk:"low" as const};
   expect(auth().decide({principal:local("ADMIN"),descriptor:forged,scope:workspace}))
     .toMatchObject({kind:"blocked",reason:"descriptor_metadata_mismatch"});
 });
 it("denies unauthorized root mutations and never authorizes effectful direct calls by default",()=>{
   expect(auth().decide({principal:local("READ"),descriptor:descriptor("add_workspace_roots"),scope:workspace}).kind).toBe("blocked");
   expect(auth().decide({principal:local(),descriptor:descriptor("add_workspace_roots"),scope:workspace}).kind).toBe("approval_required");
   expect(auth().decide({principal:local("DEVELOPER"),descriptor:descriptor("git_commit"),scope:workspace}).kind).toBe("approval_required");
   expect(auth().decide({principal:local("PROJECT_ACCESS"),descriptor:descriptor("write_file"),scope:workspace}).kind).toBe("approval_required");
 });
});