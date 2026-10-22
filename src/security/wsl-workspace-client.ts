import fs from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { spawn } from "../services/spawn.js";
import { packagedOwnerWorkerPath } from "../services/git/owner-worker-client.js";
import { getWSLWorkspaceBinding, type WSLWorkspaceBinding } from "./wsl-workspace-binding.js";
import { wslRelativePath } from "./wsl-workspace-uri.js";

export type WSLFileOperation = "probe" | "read" | "list" | "search" | "stat" | "git_status" | "git_diff" | "git_log" | "git_commit_reconcile";
export type WSLMutationOperation = "create" | "write_existing" | "modify_existing" | "delete_existing" | "restore_created" | "restore_deleted" | "restore_modified";
export interface WSLMutationRequest {
  version: 1;
  operation: WSLMutationOperation;
  path: string;
  content?: string;
  query?: string;
  expectedSha256?: string;
  restoredSha256?: string;
}
export interface WSLFileResponse {
 ok: boolean;
 error?: string;
 created?: boolean;
 restored?: boolean;
 state?: "absent" | "present" | "applied" | "unresolved";
 gitStdout?: string;
 gitStderr?: string;
 stagedFiles?: number;
 replacedOccurrences?: number;
 content?: string;
 sha256?: string;
 entries?: string[];
 detailedEntries?: Array<{name:string;type:"file"|"directory"}>;
 matches?: Array<{path:string;line:number;text:string}>;
 truncated?: boolean;
 distro?: string;
 linuxRoot?: string;
}
function permittedChildEnv(): NodeJS.ProcessEnv {
 const vars=["PATH","PATHEXT","SystemRoot","SystemDrive","WINDIR","TEMP","TMP","USERPROFILE","APPDATA","LOCALAPPDATA","ProgramData"];
 const env:NodeJS.ProcessEnv={};
 for(const key of vars){if(process.env[key])env[key]=process.env[key];}
 return env;
}
function workerBinary():string{
 const exe=packagedOwnerWorkerPath(process.execPath);
 if(!exe || process.platform!=="win32" || !fs.existsSync(exe))throw new Error("wslfs_owner_worker_not_packaged");
 return exe;
}
function workerArgs(binding:WSLWorkspaceBinding,operation:WSLFileOperation,relative:string,query="",includeSHA256=false):string[]{
 if(!path.win32.isAbsolute(binding.ownerWindowsRoot)||
  binding.ownerWindowsRoot.startsWith("\\\\"))
  throw new Error("wslfs_invalid_windows_owner_anchor");
 const safe=wslRelativePath(relative);
 return ["-mode","wslfs-proxy","-root",binding.ownerWindowsRoot,
  "-fs-request-b64",Buffer.from(JSON.stringify({version:1,operation,path:safe,query,includeSha256:includeSHA256}),"utf8").toString("base64")];
}
export function validateWSLFileResponse(json:string,binding:WSLWorkspaceBinding,operation:WSLFileOperation,includeSHA256=false):WSLFileResponse {
 let value:unknown;
 try{value=JSON.parse(json);}catch{throw new Error("wslfs_invalid_worker_response")}
 if(!value||typeof value!=="object"||typeof (value as {ok?:unknown}).ok!=="boolean")
  throw new Error("wslfs_invalid_worker_response");
 const res=value as WSLFileResponse;
 if(operation==="probe" && res.ok && (res.distro!==binding.distro||res.linuxRoot!==binding.linuxRoot))
  throw new Error("wslfs_enrolled_root_mismatch");
 if(res.error&&typeof res.error!=="string")throw new Error("wslfs_invalid_worker_response");
 if(res.content!==undefined && (typeof res.content!=="string"||Buffer.byteLength(res.content)>1024*1024))
  throw new Error("wslfs_invalid_content");
 if(res.entries && (!Array.isArray(res.entries)||res.entries.length>5000||res.entries.some(x=>typeof x!=="string")))
  throw new Error("wslfs_invalid_directory");
 if(res.detailedEntries && (!Array.isArray(res.detailedEntries)||res.detailedEntries.length>5000||
   res.detailedEntries.some(x=>typeof x.name!=="string" || x.name.includes("/") || x.name.includes("\\") ||
     !["file","directory"].includes(x.type))))throw new Error("wslfs_invalid_directory");
 if(res.matches !== undefined && res.matches !== null && (!Array.isArray(res.matches)||res.matches.length>1000 ||
   res.matches.some(x=>!x||typeof x!=="object"||
     typeof x.path!=="string" || typeof x.line!=="number" ||
     !Number.isSafeInteger(x.line) || x.line<1 ||
     typeof x.text!=="string" || Buffer.byteLength(x.text,"utf8")>2048 ||
     (()=>{try{return wslRelativePath(x.path)===".";}catch{return true;}})())))
  throw new Error("wslfs_invalid_search_results");
 if(res.ok){
  if(operation.startsWith("git_")){
   if(typeof res.gitStdout!=="string" || Buffer.byteLength(res.gitStdout,"utf8")>1024*1024 ||
      (res.gitStderr!==undefined && (typeof res.gitStderr!=="string" ||
       Buffer.byteLength(res.gitStderr,"utf8")>1024*1024)))
    throw new Error("wslgit_invalid_output");
  }
  if(operation==="stat"){
   if(res.state!=="absent" && res.state!=="present")throw new Error("wslfs_stat_invalid_state");
   if(res.state==="present" && (!res.sha256 || !/^[a-f0-9]{64}$/.test(res.sha256)))
     throw new Error("wslfs_stat_invalid_revision");
   if(res.state==="absent" && res.sha256!==undefined && res.sha256!=="")
     throw new Error("wslfs_stat_unexpected_digest");
  }
  if(operation==="read"){
   if(typeof res.content!=="string")throw new Error("wslfs_missing_content");
   if(includeSHA256){
    const hash=createHash("sha256").update(res.content,"utf8").digest("hex");
    if(res.sha256!==hash)throw new Error("wslfs_sha256_mismatch");
   }
  }
  if(operation==="list" && (!Array.isArray(res.detailedEntries) ||
     !Array.isArray(res.entries) || res.entries.length!==res.detailedEntries.length ||
     res.detailedEntries.some((e,i)=>res.entries?.[i]!==e.name)))
   throw new Error("wslfs_missing_directory_entries");
  if(operation==="search" && (!Array.isArray(res.matches) || (res.truncated!==undefined && typeof res.truncated!=="boolean")))
   throw new Error("wslfs_missing_search_results");
 }
 return res;
}
// Workspace-policy registration and open_project checks have synchronous
// contracts; only those bounded checks use spawnSync. Actual file IO is async.
export function probeWSLWorkspace(binding:WSLWorkspaceBinding): boolean {
 try {
  const child=spawnSync(workerBinary(),workerArgs(binding,"probe","."),{
   cwd:binding.ownerWindowsRoot,timeout:35000,encoding:"utf8",windowsHide:true,
   maxBuffer:2*1024*1024,env:permittedChildEnv(),shell:false,
  });
  if(child.error||child.status!==0)return false;
  return validateWSLFileResponse(child.stdout,binding,"probe").ok;
 }catch{return false;}
}

const SHA256_HEX=/^[a-f0-9]{64}$/;
const WSL_WRITE_OPS=new Set<string>([
 "create","write_existing","modify_existing","delete_existing",
 "restore_created","restore_deleted","restore_modified",
]);

/** The write-only named pipe is independently enrolled under the signed-in
 * Windows owner's SID. The read-only pipe cannot perform any mutation. */
export function validateWSLMutationRequest(req:WSLMutationRequest):string {
 if(req.version!==1 || !WSL_WRITE_OPS.has(req.operation))
   throw new Error("wslfs_write_operation_not_supported");
 const rel=wslRelativePath(req.path);
 if(rel===".")throw new Error("wslfs_write_root_denied");
 if(req.content!==undefined &&
    (typeof req.content!=="string" || Buffer.byteLength(req.content,"utf8")>1024*1024 ||
     req.content.includes("\0") || Buffer.from(req.content,"utf8").toString("utf8")!==req.content))
   throw new Error("wslfs_write_content_invalid");
 if(req.query!==undefined && (typeof req.query!=="string" || req.query.length>256))
   throw new Error("wslfs_write_query_invalid");
 const expected=["write_existing","modify_existing","delete_existing",
   "restore_created","restore_deleted","restore_modified"].includes(req.operation);
 if(expected!==Boolean(req.expectedSha256 && SHA256_HEX.test(req.expectedSha256)))
   throw new Error("wslfs_expected_sha256_required_or_unexpected");
 if(req.operation==="restore_modified" && (!req.restoredSha256 || !SHA256_HEX.test(req.restoredSha256)))
   throw new Error("wslfs_restore_sha256_required");
 if(req.operation!=="restore_modified" && req.restoredSha256!==undefined)
   throw new Error("wslfs_unexpected_restore_sha256");
 if(["create","write_existing","modify_existing","restore_deleted","restore_modified"].includes(req.operation) &&
    typeof req.content!=="string")
   throw new Error("wslfs_write_content_required");
 if(["delete_existing","restore_created"].includes(req.operation) && req.content!==undefined)
   throw new Error("wslfs_write_content_unexpected");
 if(req.operation==="modify_existing" && !req.query)
   throw new Error("wslfs_modify_query_required");
 if(req.operation!=="modify_existing" && req.query!==undefined)
   throw new Error("wslfs_write_query_unexpected");
 const bytes=JSON.stringify(req);
 if(Buffer.byteLength(bytes,"utf8")>2*1024*1024)
   throw new Error("wslfs_write_request_too_large");
 return bytes;
}

export function validateWSLMutationResponse(raw:string,req:WSLMutationRequest):WSLFileResponse {
 let res:WSLFileResponse;
 try {res=JSON.parse(raw) as WSLFileResponse;}
 catch {throw new Error("wslfs_invalid_write_response");}
 if(!res || typeof res.ok!=="boolean")throw new Error("wslfs_invalid_write_response");
 if(!res.ok)throw new Error(typeof res.error==="string"?res.error:"wslfs_write_outcome_unknown");
 if(["delete_existing","restore_created"].includes(req.operation)) {
   if(req.operation==="restore_created" && res.restored!==true)throw new Error("wslfs_invalid_write_response");
 } else {
   if(typeof res.sha256!=="string" || !SHA256_HEX.test(res.sha256))
     throw new Error("wslfs_write_digest_missing");
   if(req.operation!=="modify_existing" && req.content!==undefined){
     const sha=createHash("sha256").update(req.content,"utf8").digest("hex");
     if(sha!==res.sha256)throw new Error("wslfs_write_digest_mismatch");
   }
 }
 if(req.operation==="create" && res.created!==true)throw new Error("wslfs_write_creation_unconfirmed");
 if(req.operation.startsWith("restore_") && res.restored!==true)
   throw new Error("wslfs_write_restoration_unconfirmed");
 if(req.operation==="modify_existing" &&
   (!Number.isSafeInteger(res.replacedOccurrences) || (res.replacedOccurrences??0)<1))
   throw new Error("wslfs_write_modification_unconfirmed");
 return res;
}

export async function invokeWSLMutationRequest(root:string,req:WSLMutationRequest):Promise<WSLFileResponse>{
 const binding=getWSLWorkspaceBinding(root);
 if(!binding)throw new Error("wslfs_workspace_not_enrolled_or_authorized");
 if(!path.win32.isAbsolute(binding.ownerWindowsRoot)||binding.ownerWindowsRoot.startsWith("\\\\"))
   throw new Error("wslfs_invalid_windows_owner_anchor");
 const request=validateWSLMutationRequest(req);
 const child=await spawn(workerBinary(),[
  "-mode","wslfs-write-proxy","-root",binding.ownerWindowsRoot,
  "-distro",binding.distro,"-linux-root",binding.linuxRoot,"-fs-stdin"
 ],{
  cwd:binding.ownerWindowsRoot,shell:false,reject:false,
  timeout:40000,maxBuffer:2*1024*1024,input:request+"\n"
 });
 if(child.timedOut || child.exitCode!==0)throw new Error("wslfs_write_outcome_unknown");
 return validateWSLMutationResponse(child.stdout,req);
}


/** Native Git mutation protocol: currently branch creation only.
 * This worker has its own Windows named pipe, separate from the read-only
 * Git/file broker and the file-mutation write worker.
 * A lost IPC acknowledgment is UNKNOWN, never safe to retry automatically. */
export function validateWSLGitBranchName(name:string):string {
 if(typeof name!=="string" || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(name) ||
   name.includes("..") || name.includes("//") || name.includes("@{") ||
   name.endsWith(".") || name.endsWith("/") || name.endsWith(".lock"))
   throw new Error("wslgit_branch_name_invalid");
 return name;
}
export function validateWSLGitBranchResponse(raw:string):WSLFileResponse {
 let obj:unknown;
 try {obj=JSON.parse(raw);}catch{throw new Error("wslgit_branch_outcome_unknown")}
 if(!obj || typeof obj!=="object" || typeof (obj as {ok?:unknown}).ok!=="boolean")
   throw new Error("wslgit_branch_outcome_unknown");
 const r=obj as WSLFileResponse;
 if(!r.ok) throw new Error(r.error ?? "wslgit_branch_failed_or_outcome_unknown");
 if(typeof r.gitStdout!=="string" || Buffer.byteLength(r.gitStdout,"utf8")>1024*1024 ||
   (r.gitStderr!==undefined && (typeof r.gitStderr!=="string" ||
     Buffer.byteLength(r.gitStderr,"utf8")>1024*1024)))
   throw new Error("wslgit_invalid_branch_response");
 return r;
}

export function validateWSLGitAddPaths(paths:string[]):string[]{
 if(!Array.isArray(paths)||paths.length<1||paths.length>100)
   throw new Error("wslgit_add_paths_invalid");
 const seen=new Set<string>();
 return paths.map(item=>{
   if(typeof item!=="string")throw new Error("wslgit_add_path_invalid");
   const rel=wslRelativePath(item);
   if(rel==="." || rel.startsWith("-") || ["*","?","[","]"].some(mark=>rel.includes(mark)) ||
     rel.split("/").some(segment=>segment.toLowerCase()===".git" ||
       segment.startsWith(".hooshix-wsl-")) || seen.has(rel))
     throw new Error("wslgit_add_path_invalid");
   seen.add(rel);
   return rel;
 });
}
export function validateWSLGitAddResponse(raw:string,pathCount:number):WSLFileResponse{
 const result=validateWSLGitBranchResponse(raw);
 if(!Number.isSafeInteger(result.stagedFiles) || result.stagedFiles!==pathCount)
   throw new Error("wslgit_add_count_mismatch_or_outcome_unknown");
 return result;
}
export async function invokeWSLGitAdd(root:string,paths:string[]):Promise<WSLFileResponse>{
 const safePaths=validateWSLGitAddPaths(paths);
 const binding=getWSLWorkspaceBinding(root);
 if(!binding)throw new Error("wslgit_workspace_not_authorized");
 if(!path.win32.isAbsolute(binding.ownerWindowsRoot) ||
    binding.ownerWindowsRoot.startsWith("\\\\"))
   throw new Error("wslgit_invalid_windows_owner_anchor");
 const request=JSON.stringify({version:1,operation:"git_add",path:".",paths:safePaths});
 if(Buffer.byteLength(request,"utf8")>8192)throw new Error("wslgit_add_request_too_large");
 const child=await spawn(workerBinary(),[
   "-mode","wslgit-write-proxy","-root",binding.ownerWindowsRoot,
   "-distro",binding.distro,"-linux-root",binding.linuxRoot,"-fs-stdin"
 ],{cwd:binding.ownerWindowsRoot,shell:false,reject:false,
   timeout:40000,maxBuffer:2*1024*1024,input:request+"\n"});
 if(child.timedOut||child.exitCode!==0)throw new Error("wslgit_add_outcome_unknown");
 return validateWSLGitAddResponse(child.stdout,safePaths.length);
}


export function validateWSLGitCommitMessage(message:string):string {
 if(typeof message!=="string"||message.length===0 || Buffer.byteLength(message,"utf8")>500 ||
   !message.trim() || message.includes("\0") ||
   Buffer.from(message,"utf8").toString("utf8")!==message)
   throw new Error("wslgit_commit_message_invalid");
 return message;
}
export function validateWSLGitCommitResponse(raw:string):WSLFileResponse {
 const result=validateWSLGitBranchResponse(raw);
 if(!result.gitStdout || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(result.gitStdout))
   throw new Error("wslgit_commit_oid_invalid_or_outcome_unknown");
 return result;
}
export function validateWSLGitCommitRequestID(requestID:string):string {
 if(typeof requestID!=="string" || !/^[0-9a-f]{32}$/.test(requestID))
   throw new Error("wslgit_commit_request_id_invalid");
 return requestID;
}

/** Read-only reconciliation. "unresolved" NEVER authorizes a replay. */
export async function invokeWSLGitCommitReconcile(root:string,requestID:string):Promise<WSLFileResponse>{
 const token=validateWSLGitCommitRequestID(requestID);
 const result=await invokeWSLFileOperation(root,"git_commit_reconcile",".",{query:token});
 if(!["applied","unresolved"].includes(result.state??"") ||
    typeof result.gitStdout!=="string" ||
    (result.state==="applied"&&!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(result.gitStdout)) ||
    (result.state==="unresolved"&&result.gitStdout!==""))
   throw new Error("wslgit_commit_reconcile_invalid_response");
 return result;
}

/**
 * Acknowledgment loss recovery has ONE read-only probe and ZERO mutation
 * retries. Unmatched, invalid, or unavailable probes remain UNKNOWN.
 */
export async function reconcileUnknownWSLGitCommit(
 requestID:string, readOnlyProbe:()=>Promise<WSLFileResponse>
):Promise<WSLFileResponse>{
 const token=validateWSLGitCommitRequestID(requestID);
 try{
  const outcome=await readOnlyProbe();
  if(outcome.ok && outcome.state==="applied" &&
     typeof outcome.gitStdout==="string" &&
     /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(outcome.gitStdout))
    return {ok:true,gitStdout:outcome.gitStdout,state:"applied"};
 }catch{ /* No positive reconciliation; mutation outcome stays unknown. */ }
 throw new Error("wslgit_commit_outcome_unknown requestId="+token);
}

export async function invokeWSLGitCommit(root:string,message:string):Promise<WSLFileResponse>{
 const text=validateWSLGitCommitMessage(message);
 const binding=getWSLWorkspaceBinding(root);
 if(!binding)throw new Error("wslgit_workspace_not_authorized");
 if(!path.win32.isAbsolute(binding.ownerWindowsRoot)||
    binding.ownerWindowsRoot.startsWith("\\\\"))
   throw new Error("wslgit_invalid_windows_owner_anchor");
 const requestID=randomBytes(16).toString("hex");
 const frame=JSON.stringify({version:1,operation:"git_commit",path:".",content:text,query:requestID});
 try {
  const child=await spawn(workerBinary(),[
    "-mode","wslgit-write-proxy","-root",binding.ownerWindowsRoot,
    "-distro",binding.distro,"-linux-root",binding.linuxRoot,"-fs-stdin"
  ],{cwd:binding.ownerWindowsRoot,shell:false,reject:false,
    timeout:40000,maxBuffer:2*1024*1024,input:frame+"\n"});
  if(child.timedOut||child.exitCode!==0)
    throw new Error("wslgit_commit_outcome_unknown");
  return validateWSLGitCommitResponse(child.stdout);
 }catch{
  // Never replay the write after an ambiguous pipe/ACK failure. A bounded
  // read-only query may positively identify the durable commit by nonce.
  // Lack of a match (or a second transport error) remains UNKNOWN.
  return reconcileUnknownWSLGitCommit(requestID,
    ()=>invokeWSLGitCommitReconcile(root,requestID));
 }
}


/** Native WSL checkout is intentionally restricted to existing local branches
 * sharing the exact current HEAD tree; no worktree file may be overwritten. */
export function validateWSLGitCheckoutResponse(raw:string,name:string):WSLFileResponse{
 const result=validateWSLGitBranchResponse(raw);
 if(result.gitStdout!==name)
  throw new Error("wslgit_checkout_postcondition_unknown");
 return result;
}
export async function invokeWSLGitCheckout(root:string,name:string,create=false):Promise<WSLFileResponse>{
 if(create)throw new Error("wslgit_checkout_create_requires_transactional_support");
 const branch=validateWSLGitBranchName(name);
 const binding=getWSLWorkspaceBinding(root);
 if(!binding)throw new Error("wslgit_workspace_not_authorized");
 if(!path.win32.isAbsolute(binding.ownerWindowsRoot) ||
  binding.ownerWindowsRoot.startsWith("\\\\"))
  throw new Error("wslgit_invalid_windows_owner_anchor");
 const frame=JSON.stringify({version:1,operation:"git_checkout",path:".",query:branch});
 const child=await spawn(workerBinary(),[
  "-mode","wslgit-write-proxy","-root",binding.ownerWindowsRoot,
  "-distro",binding.distro,"-linux-root",binding.linuxRoot,"-fs-stdin"
 ],{cwd:binding.ownerWindowsRoot,shell:false,reject:false,
  timeout:40000,maxBuffer:2*1024*1024,input:frame+"\n"});
 if(child.timedOut||child.exitCode!==0)
  throw new Error("wslgit_checkout_outcome_unknown");
 return validateWSLGitCheckoutResponse(child.stdout,branch);
}

export async function invokeWSLGitCreateBranch(root:string,name:string):Promise<WSLFileResponse> {
 const branch=validateWSLGitBranchName(name);
 const binding=getWSLWorkspaceBinding(root);
 if(!binding)throw new Error("wslgit_workspace_not_authorized");
 if(!path.win32.isAbsolute(binding.ownerWindowsRoot) ||
   binding.ownerWindowsRoot.startsWith("\\\\"))
   throw new Error("wslgit_invalid_windows_owner_anchor");
 const frame=JSON.stringify({version:1,operation:"git_branch",path:".",query:branch});
 const child=await spawn(workerBinary(),[
   "-mode","wslgit-write-proxy","-root",binding.ownerWindowsRoot,
   "-distro",binding.distro,"-linux-root",binding.linuxRoot,"-fs-stdin"
 ],{cwd:binding.ownerWindowsRoot,shell:false,reject:false,
    timeout:40000,maxBuffer:2*1024*1024,input:frame+"\n"});
 if(child.timedOut||child.exitCode!==0)throw new Error("wslgit_branch_outcome_unknown");
 return validateWSLGitBranchResponse(child.stdout);
}

export async function invokeWSLFileOperation(root:string,operation:WSLFileOperation,
 relative:string,options?:{query?:string;includeSHA256?:boolean}):Promise<WSLFileResponse>{
 const binding=getWSLWorkspaceBinding(root);
 if(!binding)throw new Error("wslfs_workspace_not_enrolled_or_authorized");
 const child=await spawn(workerBinary(),workerArgs(binding,operation,relative,options?.query,options?.includeSHA256),{
  cwd:binding.ownerWindowsRoot,shell:false,reject:false,timeout:40000,maxBuffer:2*1024*1024,
 });
 if(child.timedOut||child.exitCode!==0)throw new Error("wslfs_owner_worker_unavailable");
 const response=validateWSLFileResponse(child.stdout,binding,operation,options?.includeSHA256);
 if(!response.ok)throw new Error(response.error??"wslfs_operation_failed");
 return response;
}
