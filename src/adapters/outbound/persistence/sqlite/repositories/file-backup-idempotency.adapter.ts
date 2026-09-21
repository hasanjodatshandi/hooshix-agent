import { withAgentDatabase } from "../../../../../core/memory/database.js";
import {createHash} from "node:crypto";
import path from "node:path";

/** SQLite-only persistence for legacy filesystem backup/idempotency operations. */
/** R4.01 immutable snapshot; restore attempts are NOT the snapshot type. */
export interface StoredFileBackup {
  readonly id:string;
  readonly path:string;
  readonly content:Buffer;
  readonly restored_at:string|null;
  readonly target_canonical_path:string|null;
  readonly previous_state:"present"|"absent"|null;
  readonly previous_revision:string|null;
  readonly content_hash:string|null;
  readonly content_ref:string|null;
  readonly post_mutation_state:"present"|"absent"|null;
  readonly post_mutation_revision:string|null;
  readonly legacy_unversioned:number;
}
function requireAbsolute(target:string):void {
  if(!path.isAbsolute(target)||path.normalize(target)!==target)
    throw new Error("backup_target_must_be_canonical_absolute_path");
}
export function persistFileBackup(id:string,correlationId:string,target:string,content:Buffer,revision:string):void {
  requireAbsolute(target);
  if(!/^[0-9a-f]{64}$/.test(revision)||createHash("sha256").update(content).digest("hex")!==revision)
    throw new Error("backup_pre_revision_mismatch");
  withAgentDatabase(db=>db.prepare(
    "INSERT INTO file_backups(id,correlation_id,path,content,created_at,file_revision,target_canonical_path,previous_state,previous_revision,content_hash,content_ref,legacy_unversioned) VALUES (?,?,?,?,?,?,?,?,?,?,?,0)"
  ).run(id,correlationId,target,content,new Date().toISOString(),revision,target,"present",revision,revision,
    "sqlite:file_backups:"+id));
}
export function persistAbsentFileBackup(id:string,correlationId:string,target:string):void {
  requireAbsolute(target);
  withAgentDatabase(db=>db.prepare(
    "INSERT INTO file_backups(id,correlation_id,path,content,created_at,target_canonical_path,previous_state,legacy_unversioned) VALUES (?,?,?,?,?,?,?,0)"
  ).run(id,correlationId,target,Buffer.alloc(0),new Date().toISOString(),target,"absent"));
}
/** A post-mutation observation is written only once, never inferred from a
 * failed/unknown effect. It must be an actual observed SHA or observed absence. */
export function recordFileBackupPostcondition(id:string,state:"present"|"absent",revision?:string):void {
  if((state==="present"&&!revision)||
     (revision!==undefined&&!/^[0-9a-f]{64}$/.test(revision))||
     (state==="absent"&&revision!==undefined))
    throw new Error("invalid_file_backup_postcondition");
  withAgentDatabase(db=>{
    const changed=db.prepare("UPDATE file_backups SET post_mutation_state=?,post_mutation_revision=? WHERE id=? AND legacy_unversioned=0 AND post_mutation_state IS NULL")
      .run(state,revision??null,id);
    if(changed.changes!==1)throw new Error("file_backup_postcondition_already_recorded_or_unknown");
  });
}
export function getStoredIdempotentResponse(key: string, operation: string, requestHash: string): unknown | undefined {
  return withAgentDatabase(db => {
    const row = db.prepare(
      "SELECT response FROM idempotency_responses WHERE id = ? AND operation = ? AND request_hash = ?"
    ).get(key, operation, requestHash) as { response: string } | undefined;
    return row ? JSON.parse(row.response) as unknown : undefined;
  });
}
export function persistIdempotentResponse(key: string, operation: string, requestHash: string, response: unknown): void {
  withAgentDatabase(db => db.prepare(
    "INSERT OR IGNORE INTO idempotency_responses(id, operation, request_hash, response, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(key, operation, requestHash, JSON.stringify(response), new Date().toISOString()));
}
export function getStoredFileBackup(id: string): StoredFileBackup | undefined {
  return withAgentDatabase(db => db.prepare(
    "SELECT id,path,content,restored_at,target_canonical_path,previous_state,previous_revision,content_hash,content_ref,post_mutation_state,post_mutation_revision,legacy_unversioned FROM file_backups WHERE id=?"
  ).get(id) as StoredFileBackup | undefined);
}
export function markFileBackupRestored(id: string): void {
  withAgentDatabase(db => db.prepare(
    "UPDATE file_backups SET restored_at=? WHERE id=?"
  ).run(new Date().toISOString(), id));
}