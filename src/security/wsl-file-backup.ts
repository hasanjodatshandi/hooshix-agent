import { createHash, randomUUID } from "node:crypto";
import { getTrustedInboundIdentity } from "../core/runtime/r2-trusted-inbound-identity.js";
import {
  getStoredFileBackup,
  recordFileBackupPostcondition, type StoredFileBackup,
  persistWSLFileSnapshotForPrincipal, isWSLFileSnapshotOwned,
  findWSLFileSnapshotOwnerRoot,
} from "../adapters/outbound/persistence/sqlite/repositories/file-backup-idempotency.adapter.js";
import { getWSLWorkspaceBinding } from "./wsl-workspace-binding.js";
import { parseWSLWorkspaceURI, wslRelativePath } from "./wsl-workspace-uri.js";
import { listWorkspaceRoots } from "./workspace-guard.js";
import { isSensitivePath } from "../application/services/sensitive-path-policy.js";

/**
 * Durable, fail-closed WSL mutation snapshots. This module never performs
 * filesystem mutations. Actual Linux writes require an independent, enrolled
 * write-capable broker and kernel-enforced revision checks. Staging a backup
 * is NOT authorization to modify a file.
 */
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_FILE_BYTES = 1024 * 1024;

export function canonicalWSLBackupTarget(root: string, relative: string): string {
  const parsed = parseWSLWorkspaceURI(root);
  if (!parsed || parsed.uri !== root) throw new Error("wsl_backup_root_not_canonical");
  const rel = wslRelativePath(relative);
  if (rel === ".") throw new Error("wsl_backup_target_is_workspace_root");
  if (isSensitivePath(rel) || rel.split("/").some(part =>
      [".git", "node_modules", "dist", "coverage", "logs", "data", "credentials"].includes(part.toLowerCase())))
    throw new Error("wsl_backup_sensitive_path_denied");
  // No win32 path.join/resolve: these paths are Linux identity descriptors.
  const target = parsed.uri + "/" + rel;
  if (parseWSLWorkspaceURI(target)?.uri !== target)
    throw new Error("wsl_backup_target_not_canonical");
  return target;
}

/** Current principal must own an enrolled binding for this exact WSL root. */
function authorizedRoot(root: string): void {
  if (!getWSLWorkspaceBinding(root))
    throw new Error("wsl_backup_workspace_not_authorized");
  if (!listWorkspaceRoots().some(entry => entry.path === root))
    throw new Error("wsl_backup_workspace_not_granted");
}

export function stageWSLFileSnapshot(
  root: string,
  relative: string,
  previousContent: string | null,
  correlationId: string,
): { backupId: string; target: string; previousRevision: string | null } {
  const target = canonicalWSLBackupTarget(root, relative);
  authorizedRoot(root);
  const backupId = randomUUID();
  const bytes = previousContent === null ? null : Buffer.from(previousContent, "utf8");
  if (bytes && (bytes.length > MAX_FILE_BYTES || bytes.includes(0)))
    throw new Error("wsl_backup_invalid_file_content");
  const digest = bytes ? createHash("sha256").update(bytes).digest("hex") : null;
  const principal = String(getTrustedInboundIdentity().principal.id);
  // Snapshot and principal ownership are persisted atomically. An aborted
  // transaction never leaves a cross-principal usable restoration token.
  persistWSLFileSnapshotForPrincipal(
    backupId, correlationId, target, root, principal, bytes, digest,
  );
  return { backupId, target, previousRevision: digest };
}

/** Commit only an independently observed completed Linux operation. */
export function confirmWSLFilePostcondition(
  backupId: string,
  root: string,
  relative: string,
  state: "present" | "absent",
  revision?: string,
): void {
  const target = canonicalWSLBackupTarget(root, relative);
  authorizedRoot(root);
  const principal = String(getTrustedInboundIdentity().principal.id);
  const owns = isWSLFileSnapshotOwned(backupId, principal, root);
  const backup = owns ? getStoredFileBackup(backupId) : undefined;
  if (!backup || backup.path !== target || backup.target_canonical_path !== target)
    throw new Error("wsl_backup_target_mismatch");
  if ((state === "present" && (!revision || !SHA256.test(revision))) ||
      (state === "absent" && revision !== undefined))
    throw new Error("wsl_backup_invalid_postcondition");
  recordFileBackupPostcondition(backupId, state, revision);
}

export interface WSLRestorePreflight {
  readonly backup: StoredFileBackup;
  readonly root: string;
  readonly relative: string;
}

/**
 * Restore can be attempted only for a currently authorized WSL root and an
 * observed post-mutation revision. No historical/unversioned backup may act
 * as permission to overwrite or remove a newer file.
 */
export function validateWSLRestoreSnapshot(backupId: string): WSLRestorePreflight {
  const principal = String(getTrustedInboundIdentity().principal.id);
  const ownerRoot = findWSLFileSnapshotOwnerRoot(backupId, principal);
  if (!ownerRoot) throw new Error("wsl_backup_not_found_or_not_owned");
  const backup = getStoredFileBackup(backupId);
  if (!backup) throw new Error("wsl_backup_not_found");
  const candidate = parseWSLWorkspaceURI(backup.path);
  if (!candidate || candidate.uri !== backup.path ||
      backup.target_canonical_path !== backup.path)
    throw new Error("wsl_backup_invalid_target");
  const root = ownerRoot;
  if (!listWorkspaceRoots().some(entry => entry.path === root) ||
      !backup.path.startsWith(root + "/") ||
      !getWSLWorkspaceBinding(root))
    throw new Error("wsl_backup_workspace_not_authorized");
  const relative = backup.path.slice(root.length + 1);
  if (canonicalWSLBackupTarget(root, relative) !== backup.path)
    throw new Error("wsl_backup_target_mismatch");
  if (backup.legacy_unversioned !== 0 ||
      (backup.previous_state !== "present" && backup.previous_state !== "absent") ||
      (backup.post_mutation_state !== "present" && backup.post_mutation_state !== "absent") ||
      (backup.post_mutation_state === "present" && (!backup.post_mutation_revision ||
        !SHA256.test(backup.post_mutation_revision))) ||
      (backup.post_mutation_state === "absent" && backup.post_mutation_revision !== null))
    throw new Error("RESTORE_POSTCONDITION_UNKNOWN");
  if (backup.previous_state === "present") {
    const digest = createHash("sha256").update(backup.content).digest("hex");
    if (!backup.previous_revision || digest !== backup.previous_revision ||
        backup.content_hash !== backup.previous_revision)
      throw new Error("RESTORE_BACKUP_INTEGRITY_FAILURE");
  }
  return { backup, root, relative };
}

/**
 * Prepare the only currently supported no-clobber Linux restore operation:
 * recovering a deleted text file from an immutable, principal-owned snapshot.
 *
 * This describes a request; it NEVER authorizes or invokes a Linux mutation.
 * The Windows owner-session worker continues to reject restore operations
 * until a separately approved write-capability protocol exists.
 */
export interface WSLRestoreDeletedRequest {
  readonly version: 1;
  readonly operation: "restore_deleted";
  readonly path: string;
  readonly content: string;
  readonly expectedSha256: string;
}
export function prepareWSLRestoreDeletedRequest(backupId: string): {
  root: string;
  request: WSLRestoreDeletedRequest;
} {
  const { backup, root, relative } = validateWSLRestoreSnapshot(backupId);
  if (backup.previous_state !== "present" || backup.post_mutation_state !== "absent")
    throw new Error("wsl_restore_mode_not_supported");
  if (backup.content.length > MAX_FILE_BYTES)
    throw new Error("wsl_restore_snapshot_size_limit");
  // Linux broker only restores strict text files and must independently
  // confirm the digest before attempting its atomic no-overwrite create.
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let content: string;
  try { content = decoder.decode(backup.content); }
  catch { throw new Error("wsl_restore_snapshot_invalid_utf8"); }
  if (content.includes("\0") || !backup.previous_revision)
    throw new Error("wsl_restore_snapshot_invalid_content");
  return {
    root,
    request: {
      version: 1,
      operation: "restore_deleted",
      path: relative,
      content,
      expectedSha256: backup.previous_revision,
    },
  };
}

/** Safe mutation plan for each versioned post-state. These request objects
 * remain inert; a distinct owner-approved Linux write channel is mandatory
 * before any of them may be executed from the MCP service. */
export type WSLRestoreMutationRequest = WSLRestoreDeletedRequest |
  {readonly version:1; readonly operation:"restore_modified";
   readonly path:string; readonly content:string;
   readonly expectedSha256:string; readonly restoredSha256:string} |
  {readonly version:1; readonly operation:"restore_created";
   readonly path:string; readonly expectedSha256:string};

export function prepareWSLRestoreMutationRequest(backupId:string):{
  readonly root:string; readonly request:WSLRestoreMutationRequest;
} {
  const {backup,root,relative}=validateWSLRestoreSnapshot(backupId);
  if(backup.previous_state==="absent" && backup.post_mutation_state==="present"){
    if(!backup.post_mutation_revision)throw new Error("RESTORE_POSTCONDITION_UNKNOWN");
    return {root,request:{version:1,operation:"restore_created",path:relative,
      expectedSha256:backup.post_mutation_revision}};
  }
  if(backup.previous_state==="present" && backup.post_mutation_state==="absent"){
    return prepareWSLRestoreDeletedRequest(backupId);
  }
  if(backup.previous_state==="present" && backup.post_mutation_state==="present"){
    const decoder=new TextDecoder("utf-8",{fatal:true});
    let content:string;
    try {content=decoder.decode(backup.content);}
    catch {throw new Error("wsl_restore_snapshot_invalid_utf8");}
    if(content.includes("\0") || !backup.previous_revision || !backup.post_mutation_revision)
      throw new Error("wsl_restore_snapshot_invalid_content");
    return {root,request:{version:1,operation:"restore_modified",path:relative,
      content,expectedSha256:backup.post_mutation_revision,
      restoredSha256:backup.previous_revision}};
  }
  throw new Error("wsl_restore_mode_not_supported");
}
