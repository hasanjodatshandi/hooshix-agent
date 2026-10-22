import { resolveCorrelationId } from "../core/runtime/correlation-id.js";
import { bestEffortAsyncTelemetry } from "../core/trace/telemetry-degradation.js";
import { logFileAction } from "../memory/file-audit.js";
import { markFileBackupRestored } from "../adapters/outbound/persistence/sqlite/repositories/file-backup-idempotency.adapter.js";
import {
  canonicalWSLBackupTarget, confirmWSLFilePostcondition,
  prepareWSLRestoreMutationRequest, stageWSLFileSnapshot,
} from "./wsl-file-backup.js";
import {
  invokeWSLFileOperation, invokeWSLMutationRequest,
  type WSLMutationRequest,
} from "./wsl-workspace-client.js";

const SHA256=/^[a-f0-9]{64}$/;
export type WSLMutationTool = "create_file"|"write_file"|"modify_file"|"delete_file"|"restore_file";
type Present={state:"present"; content:string; sha256:string};
type Absent={state:"absent"};
type FileState=Present|Absent;

async function currentState(root:string,relative:string):Promise<FileState> {
 const stat=await invokeWSLFileOperation(root,"stat",relative);
 if(stat.state==="absent")return {state:"absent"};
 if(stat.state!=="present" || !stat.sha256 || !SHA256.test(stat.sha256))
   throw new Error("wslfs_stat_inconsistent");
 const content=await invokeWSLFileOperation(root,"read",relative,{includeSHA256:true});
 if(content.sha256!==stat.sha256 || typeof content.content!=="string")
   throw new Error("wslfs_observation_changed");
 return {state:"present",content:content.content,sha256:stat.sha256};
}
function expectedMatches(observed:FileState,expected:FileState):boolean{
 return observed.state===expected.state &&
   (observed.state==="absent" || expected.state==="absent" || observed.sha256===expected.sha256);
}
async function verifyState(root:string,relative:string,expected:"present"|"absent",sha?:string):Promise<void>{
 const stat=await invokeWSLFileOperation(root,"stat",relative);
 if(stat.state!==expected || (expected==="present" && stat.sha256!==sha))
   throw new Error("wslfs_write_postcondition_not_verified");
}
function validateText(content:string):void {
 if(Buffer.byteLength(content,"utf8")>1024*1024 ||
    content.includes("\0") || Buffer.from(content,"utf8").toString("utf8")!==content)
   throw new Error("wslfs_mutation_invalid_text");
}

/** A WSL mutation is never handled by native Windows fs, shell, or arbitrary
 * UNC IO. Linux owns the atomic CAS; SQLite snapshots and postconditions are
 * principal-bound. A timeout leaves an unresolved snapshot, never a retry. */
export async function mutateWSLFile(
 root:string,tool:WSLMutationTool,args:Record<string,unknown>,correlationId?:string
):Promise<Record<string,unknown>> {
 const trace=resolveCorrelationId(correlationId);
 const pathArg=typeof args.path==="string"?args.path:undefined;
 const auditTarget=tool==="restore_file"?String(args.backupId??"unknown"):
   canonicalWSLBackupTarget(root,pathArg??".");
 let completed=false;
 try {
  if(tool==="restore_file"){
   const id=String(args.backupId??"");
   const {root:backupRoot,request,}=prepareWSLRestoreMutationRequest(id);
   if(backupRoot!==root)throw new Error("wsl_restore_workspace_mismatch");
   const preflight=await currentState(root,request.path);
   const postExpected=request.operation==="restore_deleted"?
     {state:"absent"} as FileState:
     {state:"present",sha256:request.expectedSha256,content:preflight.state==="present"?preflight.content:""} as FileState;
   if(!expectedMatches(preflight,postExpected))
     throw new Error("RESTORE_REVISION_CONFLICT");
   const displaced=stageWSLFileSnapshot(root,request.path,
     preflight.state==="present"?preflight.content:null,trace);
   const out=await invokeWSLMutationRequest(root,request);
   const newState=request.operation==="restore_created"?"absent":"present";
   const newDigest=newState==="present"?
     (request.operation==="restore_modified"?request.restoredSha256:request.expectedSha256):undefined;
   await verifyState(root,request.path,newState,newDigest);
   confirmWSLFilePostcondition(displaced.backupId,root,request.path,newState,newDigest);
   markFileBackupRestored(id);
   completed=true;
   return {backupId:id,displacedBackupId:displaced.backupId,path:auditTarget,restored:true,previousState:preflight.state,sha256:out.sha256};
  }

  if(!pathArg)throw new Error("wslfs_mutation_path_required");
  const target=canonicalWSLBackupTarget(root,pathArg);
  const pre=await currentState(root,pathArg);
  if(tool==="create_file" && pre.state!=="absent")throw new Error("wslfs_file_already_exists");
  if(tool!=="create_file" && tool!=="write_file" && pre.state!=="present")throw new Error("wslfs_file_not_present");

  const expected=pre.state==="present"?pre.sha256:undefined;
  const userRevision=args.ifMatchSha256;
  if(userRevision!==undefined &&
     (typeof userRevision!=="string"||!SHA256.test(userRevision)||userRevision!==expected))
    throw new Error("wslfs_revision_precondition_failed");
  if(args.idempotencyKey!==undefined)
    throw new Error("wslfs_idempotency_receipt_not_implemented");

  let req:WSLMutationRequest;
  if(tool==="delete_file") {
   req={version:1,operation:"delete_existing",path:pathArg,expectedSha256:expected};
  } else if(tool==="modify_file"){
   if(typeof args.search!=="string"||!args.search||args.search.length>256 ||
      typeof args.replacement!=="string")throw new Error("wslfs_modify_arguments_invalid");
   validateText(args.replacement);
   req={version:1,operation:"modify_existing",path:pathArg,
     query:args.search,content:args.replacement,expectedSha256:expected};
  }else {
   if(typeof args.content!=="string")throw new Error("wslfs_content_required");
   validateText(args.content);
   req={version:1,operation:tool==="create_file"||pre.state==="absent"?"create":"write_existing",path:pathArg,
     content:args.content,expectedSha256:expected};
  }
  // Backup must exist before invoking the owner-side write worker.
  const snapshot=stageWSLFileSnapshot(root,pathArg,
    pre.state==="present"?pre.content:null,trace);
  const result=await invokeWSLMutationRequest(root,req);
  const postState=tool==="delete_file"?"absent":"present";
  const postHash=postState==="present"?result.sha256:undefined;
  if(postState==="present" && (!postHash||!SHA256.test(postHash)))
    throw new Error("wslfs_write_digest_missing");
  await verifyState(root,pathArg,postState,postHash);
  confirmWSLFilePostcondition(snapshot.backupId,root,pathArg,postState,postHash);
  completed=true;
  return {backupId:snapshot.backupId,path:target,
    previousState:pre.state,created:pre.state==="absent",
    ...(tool==="modify_file"?{replacedOccurrences:result.replacedOccurrences}:{}),
    ...(postHash?{sha256:postHash}:{})};
 }catch(error){
   // Even an error can follow a completed Linux mutation. Never retry an
   // unknown external effect; operator reconciliation uses durable snapshot.
   await bestEffortAsyncTelemetry(()=>logFileAction("wsl_"+tool,auditTarget,trace,"failed"));
   throw error;
 }finally{
   if(completed)await bestEffortAsyncTelemetry(()=>logFileAction("wsl_"+tool,auditTarget,trace,"success"));
 }
}
