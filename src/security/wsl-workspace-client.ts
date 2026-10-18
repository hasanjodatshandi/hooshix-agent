import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { spawn } from "../services/spawn.js";
import { packagedOwnerWorkerPath } from "../services/git/owner-worker-client.js";
import { getWSLWorkspaceBinding, type WSLWorkspaceBinding } from "./wsl-workspace-binding.js";
import { wslRelativePath } from "./wsl-workspace-uri.js";

export type WSLFileOperation = "probe" | "read" | "list" | "search";
export interface WSLFileResponse {
 ok: boolean;
 error?: string;
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
function validateResult(json:string,binding:WSLWorkspaceBinding,operation:WSLFileOperation):WSLFileResponse {
 let value:unknown;
 try{value=JSON.parse(json);}catch{throw new Error("wslfs_invalid_worker_response")}
 if(!value||typeof value!=="object"||typeof (value as {ok?:unknown}).ok!=="boolean")
  throw new Error("wslfs_invalid_worker_response");
 const res=value as WSLFileResponse;
 if(operation==="probe" && (res.distro!==binding.distro||res.linuxRoot!==binding.linuxRoot))
  throw new Error("wslfs_enrolled_root_mismatch");
 if(res.error&&typeof res.error!=="string")throw new Error("wslfs_invalid_worker_response");
 if(res.content!==undefined && (typeof res.content!=="string"||Buffer.byteLength(res.content)>1024*1024))
  throw new Error("wslfs_invalid_content");
 if(res.entries && (!Array.isArray(res.entries)||res.entries.length>5000||res.entries.some(x=>typeof x!=="string")))
  throw new Error("wslfs_invalid_directory");
 if(res.detailedEntries && (!Array.isArray(res.detailedEntries)||res.detailedEntries.length>5000||
   res.detailedEntries.some(x=>typeof x.name!=="string" || x.name.includes("/") || x.name.includes("\\") ||
     !["file","directory"].includes(x.type))))throw new Error("wslfs_invalid_directory");
 if(res.matches && (!Array.isArray(res.matches)||res.matches.length>1000))
  throw new Error("wslfs_invalid_search_results");
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
  return validateResult(child.stdout,binding,"probe").ok;
 }catch{return false;}
}
export async function invokeWSLFileOperation(root:string,operation:WSLFileOperation,
 relative:string,options?:{query?:string;includeSHA256?:boolean}):Promise<WSLFileResponse>{
 const binding=getWSLWorkspaceBinding(root);
 if(!binding)throw new Error("wslfs_workspace_not_enrolled_or_authorized");
 const child=await spawn(workerBinary(),workerArgs(binding,operation,relative,options?.query,options?.includeSHA256),{
  cwd:binding.ownerWindowsRoot,shell:false,reject:false,timeout:40000,maxBuffer:2*1024*1024,
 });
 if(child.timedOut||child.exitCode!==0)throw new Error("wslfs_owner_worker_unavailable");
 const response=validateResult(child.stdout,binding,operation);
 if(!response.ok)throw new Error(response.error??"wslfs_operation_failed");
 return response;
}