import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { validateWorkspace, getActiveWorkspace } from "../../security/workspace-guard.js";
import { isSensitivePath } from "../../application/services/sensitive-path-policy.js";
import { policyDecisionPoint } from "../../core/governance/policy-decision-point.js";
import { logFileAction } from "../../memory/file-audit.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";
import { bestEffortAsyncTelemetry } from "../../core/trace/telemetry-degradation.js";
import { SearchBudgetMeter, workspaceSearchLimiter } from "./search-budget.js";
import { persistFileBackup, persistAbsentFileBackup, getStoredIdempotentResponse, persistIdempotentResponse, getStoredFileBackup, markFileBackupRestored, recordFileBackupPostcondition } from "../../adapters/outbound/persistence/sqlite/repositories/file-backup-idempotency.adapter.js";

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_SEARCH_LINE_BYTES = 512;
const MAX_DIRECTORY_ENTRIES = 5000;
const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", "coverage", "data", "logs"]);

/**
 * Sensitive file denylist: basenames (any directory) and path suffixes the agent
 * must never read, write, or exfiltrate via read_file/search_files. Blocking at
 * the service layer so both direct MCP calls and task steps are covered.
 */
function isSensitiveCanonicalPath(filePath: string): boolean {
  // In-workspace symlinks may point at sensitive files under innocuous aliases.
  if (isSensitivePath(filePath)) return true;
  let existing = path.resolve(filePath);
  while (!fsSync.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) return true;
    existing = parent;
  }
  try {
    const actual = fsSync.realpathSync(existing);
    return isSensitivePath(path.resolve(actual, path.relative(existing, filePath)));
  } catch {
    return true;
  }
}
function assertNotSensitive(filePath: string): void {
  if (isSensitiveCanonicalPath(filePath)) {
    throw new Error("Access denied: sensitive-file denylist");
  }
}

/**
 * True when a file must be excluded from search results. Unlike the read/write
 * denylist this is non-throwing: a sensitive file inside the workspace is
 * silently skipped instead of aborting the whole search. Matches either the
 * basename denylist, a sensitive extension, or a sensitive directory segment.
 */
export function isSensitiveSearchHit(filePath: string): boolean {
  return isSensitivePath(filePath);
}

export interface FileMutationResult {
  backupId?: string;
  /** Backup of the content that was displaced by a restore (undo of the undo) */
  displacedBackupId?: string;
  path?: string;
  restored?: boolean;
  /** True only when the target already matches the immutable previous state (no write/delete). */
  alreadyRestored?: boolean;
  /** Whether a file was newly created (was previously absent) */
  created?: boolean;
  /** Whether the file existed before this operation */
  previousState?: "present" | "absent";
  /** Number of occurrences replaced by modify_file */
  replacedOccurrences?: number;
}

async function audit<T>(action: string, targetPath: string, correlationId: string | undefined, operation: (traceId: string) => Promise<T>): Promise<T> {
  const traceId = resolveCorrelationId(correlationId);
  let result:T;
  try {
    result = await operation(traceId);
  } catch (error) {
    // The audit sink must never mask the ORIGINAL business failure.
    await bestEffortAsyncTelemetry(() => logFileAction(action, targetPath, traceId, "failed"));
    throw error;
  }
  // The external effect is already known to have succeeded: a telemetry
  // failure must not report the effect as failed or cause a duplicate retry.
  await bestEffortAsyncTelemetry(() => logFileAction(action, targetPath, traceId, "success"));
  return result;
}

async function assertReadableSize(filePath: string): Promise<void> {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error("Target is not a file");
  if (stat.size > MAX_FILE_BYTES) throw new Error(`File exceeds ${MAX_FILE_BYTES} byte limit`);
}

/**
 * Open a file and read it through a SINGLE file descriptor so the identity and
 * the bytes cannot be swapped between the containment/sensitivity check and the
 * read (a TOCTOU window). validateWorkspace realpath-checks the path and
 * assertNotSensitive walks symlinks before this call; opening the path then
 * pins the inode, and both fstat and readFile operate on that pinned handle —
 * a symlink flipped in the gap can no longer redirect the read outside the
 * workspace. (Audit LOW-02.)
 */
async function readPinnedFile(filePath: string): Promise<string> {
  const handle = await fs.open(filePath, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("Target is not a file");
    if (stat.size > MAX_FILE_BYTES) throw new Error(`File exceeds ${MAX_FILE_BYTES} byte limit`);
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

async function atomicWrite(filePath: string, content: string | Buffer, options?: { flag?: string }): Promise<void> {
  if (options?.flag === "wx") {
    // Exclusive create: must fail if the target exists. Writing to a temp
    // file and renaming would silently overwrite, so use a fsync'd direct
    // create instead — a crash can only leave the file absent, never partial.
    const handle = await fs.open(filePath, "wx");
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    return;
  }
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  try {
    // fsync so the data hits the disk before the rename — a crash between
    // write and rename must never leave an empty/partial file at the target.
    const handle = await fs.open(temporary, "w");
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    // On Windows, rename can fail with EPERM if the target was recently
    // written (kernel lock delay). Retry a few times with a short delay.
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await fs.rename(temporary, filePath);
        lastError = undefined;
        break;
      } catch (err) {
        lastError = err;
        const code = err instanceof Error && "code" in err ? (err as NodeJS.ErrnoException).code : undefined;
        if (code !== "EPERM" || attempt === 2) throw err;
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
      }
    }
    if (lastError) throw lastError;
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function backupFile(filePath: string, _targetPath: string, correlationId: string): Promise<string> {
  await assertReadableSize(filePath);
  const id = randomUUID();
  const content = await fs.readFile(filePath);
  const sha256 = createHash("sha256").update(content).digest("hex");
  // Store the CANONICAL absolute path, never the raw caller string. A raw
  // relative path would be re-resolved against whatever workspace is active
  // at restore time — materializing the file in the WRONG workspace
  // (defect FS-01, a workspace-isolation break).
  const canonical = validateWorkspace(filePath);
  persistFileBackup(id, correlationId, canonical, content, sha256);
  return id;
}

/** Compute SHA-256 over exact UTF-8 string bytes or a binary file buffer. */
function sha256hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

// ─── Idempotency support for file mutations ───────────────────────

/** Normalize a request payload for idempotency comparison. */
function normalizeRequest(...parts: unknown[]): string {
  return sha256hex(JSON.stringify(parts));
}

/**
 * Check for a cached idempotent response.
 * Returns the cached response if found, undefined otherwise.
 */
function getIdempotentResponse(idempotencyKey: string, operation: string, requestHash: string): unknown | undefined {
  return getStoredIdempotentResponse(idempotencyKey, operation, requestHash);
}

/**
 * Store an idempotent response for future deduplication.
 */
function storeIdempotentResponse(idempotencyKey: string, operation: string, requestHash: string, response: unknown): void {
  persistIdempotentResponse(idempotencyKey, operation, requestHash, response);
}

export async function readWorkspaceFile(targetPath: string, correlationId?: string, options?: { includeSha256?: boolean }): Promise<string | { content: string; sha256: string }> {
  return audit("read", targetPath, correlationId, async () => {
    policyDecisionPoint.assertAllowed({ tool: "read_file", arguments: { path: targetPath }, correlationId });
    const filePath = validateWorkspace(targetPath);
    assertNotSensitive(filePath);
    const content = await readPinnedFile(filePath);
    if (options?.includeSha256) return { content, sha256: sha256hex(content) };
    return content;
  });
}

export async function createWorkspaceFile(targetPath: string, content: string, correlationId?: string): Promise<FileMutationResult> {
  return audit("create", targetPath, correlationId, async (traceId) => {
    policyDecisionPoint.assertAllowed({ tool: "create_file", arguments: { path: targetPath }, correlationId });
    if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) throw new Error(`Content exceeds ${MAX_FILE_BYTES} byte limit`);
    const filePath = validateWorkspace(targetPath);
    assertNotSensitive(filePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    validateWorkspace(path.dirname(filePath));
    // Atomic create like write_file: temp file + rename so a crash never leaves a partial file
    // An exclusive create displaces the ABSENT state; capture it before the
    // effect, and only attach the post-revision after observing the new bytes.
    if (await fs.access(filePath).then(() => true, () => false))
      throw new Error("Target already exists");
    const backupId = await saveAbsentSnapshot(targetPath, traceId);
    await atomicWrite(filePath, content, { flag: "wx" });
    recordFileBackupPostcondition(backupId,"present",sha256hex(content));
    return { backupId, path: targetPath, created: true, previousState: "absent" as const };
  });
}

async function saveAbsentSnapshot(targetPath: string, correlationId: string): Promise<string> {
  const id = randomUUID();
  // Canonical absolute path only — same isolation rule as backupFile (FS-01):
  // a relative snapshot path would re-resolve against the active workspace at
  // restore time and materialize in the wrong workspace.
  const canonical = validateWorkspace(targetPath);
  persistAbsentFileBackup(id, correlationId, canonical);
  return id;
}

export async function writeWorkspaceFile(targetPath: string, content: string, correlationId?: string, options?: { ifMatchSha256?: string; idempotencyKey?: string }): Promise<FileMutationResult> {
  return audit("write", targetPath, correlationId, async (traceId) => {
    policyDecisionPoint.assertAllowed({ tool: "write_file", arguments: { path: targetPath }, correlationId });
    if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) throw new Error(`Content exceeds ${MAX_FILE_BYTES} byte limit`);
    // Idempotency: check for cached response
    if (options?.idempotencyKey) {
      const reqHash = normalizeRequest(targetPath, content);
      const cached = getIdempotentResponse(options.idempotencyKey, "write", reqHash);
      if (cached !== undefined) return cached as FileMutationResult;
    }
    const filePath = validateWorkspace(targetPath);
    assertNotSensitive(filePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    validateWorkspace(path.dirname(filePath));
    const existed = await fs.access(filePath).then(() => true, () => false);
    // Optimistic concurrency: check SHA-256 precondition before mutating
    if (options?.ifMatchSha256 !== undefined && existed) {
      const current = await fs.readFile(filePath, "utf8");
      const currentSha = sha256hex(current);
      if (currentSha !== options.ifMatchSha256) {
        const err = new Error(`STALE_WRITE: file has been modified since last read. Expected sha256=${options.ifMatchSha256}, got sha256=${currentSha}`);
        Object.assign(err, { errorType: "STALE_WRITE", currentSha256: currentSha, expectedSha256: options.ifMatchSha256 });
        throw err;
      }
    } else if (options?.ifMatchSha256 !== undefined && !existed) {
      const err = new Error("STALE_WRITE: expected file to exist but it is absent");
      Object.assign(err, { errorType: "STALE_WRITE" });
      throw err;
    }
    const backupId = existed
      ? await backupFile(filePath, targetPath, traceId)
      : await saveAbsentSnapshot(targetPath, traceId);
    await atomicWrite(filePath, content);
    recordFileBackupPostcondition(backupId,"present",sha256hex(content));
    const result: FileMutationResult = { backupId, path: targetPath, created: !existed, previousState: existed ? "present" : "absent" };
    // Cache idempotent response
    if (options?.idempotencyKey) {
      storeIdempotentResponse(options.idempotencyKey, "write", normalizeRequest(targetPath, content), result);
    }
    return result;
  });
}

export async function modifyWorkspaceFile(targetPath: string, search: string, replacement: string, correlationId?: string, options?: { ifMatchSha256?: string }): Promise<FileMutationResult> {
  return audit("modify", targetPath, correlationId, async (traceId) => {
    policyDecisionPoint.assertAllowed({ tool: "modify_file", arguments: { path: targetPath }, correlationId });
    if (!search) throw new Error("Search text must not be empty");
    if (Buffer.byteLength(search, "utf8") > MAX_FILE_BYTES) throw new Error(`Search text exceeds ${MAX_FILE_BYTES} byte limit`);
    if (Buffer.byteLength(replacement, "utf8") > MAX_FILE_BYTES) throw new Error(`Replacement text exceeds ${MAX_FILE_BYTES} byte limit`);
    const filePath = validateWorkspace(targetPath);
    assertNotSensitive(filePath);
    await assertReadableSize(filePath);
    const content = await fs.readFile(filePath, "utf8");
    // Optimistic concurrency: check SHA-256 precondition before mutating
    if (options?.ifMatchSha256 !== undefined) {
      const currentSha = sha256hex(content);
      if (currentSha !== options.ifMatchSha256) {
        const err = new Error(`STALE_WRITE: file has been modified since last read. Expected sha256=${options.ifMatchSha256}, got sha256=${currentSha}`);
        Object.assign(err, { errorType: "STALE_WRITE", currentSha256: currentSha, expectedSha256: options.ifMatchSha256 });
        throw err;
      }
    }
    const occurrences = content.split(search).length - 1;
    if (occurrences === 0) throw new Error("Target text was not found");
    // split/join replaces ALL occurrences literally — String.replace with a string
    // pattern replaces only the first occurrence AND processes $&/$'/$` in the replacement.
    const updated = content.split(search).join(replacement);
    if (Buffer.byteLength(updated, "utf8") > MAX_FILE_BYTES) throw new Error(`Content exceeds ${MAX_FILE_BYTES} byte limit`);
    const backupId = await backupFile(filePath, targetPath, traceId);
    await atomicWrite(filePath, updated);
    recordFileBackupPostcondition(backupId,"present",sha256hex(updated));
    return { backupId, path: targetPath, previousState: "present" as const, replacedOccurrences: occurrences };
  });
}

export async function deleteWorkspaceFile(targetPath: string, correlationId?: string, options?: { idempotencyKey?: string }): Promise<FileMutationResult> {
  return audit("delete", targetPath, correlationId, async (traceId) => {
    // Validate path + sensitivity BEFORE the approval gate so an invalid or
    // sensitive target fails fast with a real reason instead of burning an
    // approval round-trip on a doomed call.
    const filePath = validateWorkspace(targetPath);
    assertNotSensitive(filePath);
    policyDecisionPoint.assertAllowed({ tool: "delete_file", arguments: { path: targetPath }, correlationId });
    // Idempotency: check for cached response
    if (options?.idempotencyKey) {
      const reqHash = normalizeRequest(targetPath);
      const cached = getIdempotentResponse(options.idempotencyKey, "delete", reqHash);
      if (cached !== undefined) return cached as FileMutationResult;
    }
    const existed = await fs.access(filePath).then(() => true, () => false);
    if (!existed) {
      // Already absent — return idempotent success for retry safety
      const result: FileMutationResult = { path: targetPath, previousState: "absent" as const };
      if (options?.idempotencyKey) {
        storeIdempotentResponse(options.idempotencyKey, "delete", normalizeRequest(targetPath), result);
      }
      return result;
    }
    const backupId = await backupFile(filePath, targetPath, traceId);
    await fs.unlink(filePath);
    recordFileBackupPostcondition(backupId,"absent");
    const result = { backupId, path: targetPath, previousState: "present" as const };
    if (options?.idempotencyKey) {
      storeIdempotentResponse(options.idempotencyKey, "delete", normalizeRequest(targetPath), result);
    }
    return result;
  });
}

/**
 * R4.02: Normal compensation is a compare-and-restore operation, not a
 * historical overwrite. There is deliberately no force flag on this API:
 * historical restoration requires a distinct approval-bound contract.
 */
export async function restoreWorkspaceFile(backupId: string, correlationId?: string): Promise<FileMutationResult> {
  return audit("restore", backupId, correlationId, async (traceId) => {
    policyDecisionPoint.assertAllowed({ tool: "restore_file", arguments: { backupId }, correlationId });
    const backup = getStoredFileBackup(backupId);
    if (!backup) throw new Error("Backup not found");
    // Authorize the STORED absolute target, never a path supplied by the caller
    // or re-anchored relative to a newly selected workspace.
    if (!path.isAbsolute(backup.path) || backup.target_canonical_path !== backup.path) {
      throw new Error("Access denied: backup has a non-canonical stored target. Restore refused.");
    }
    let filePath: string;
    try {
      filePath = validateWorkspace(backup.path);
      assertNotSensitive(filePath);
    } catch {
      throw new Error(
        `Access denied: backup ${backupId} targets '${backup.path}' which is outside the active workspace. ` +
        "Backups can only be restored in the workspace they were taken in — set_workspace back to the original workspace first."
      );
    }
    if (backup.previous_state !== "absent" && backup.previous_state !== "present")
      throw new Error("backup_previous_state_unclassified");

    // A v14 row can describe a pre-state without proving that the original
    // external mutation completed. Such a row is NOT an authorization to
    // overwrite the current file. Old rows have no trustworthy post-state.
    if (backup.legacy_unversioned !== 0 ||
        (backup.post_mutation_state !== "present" && backup.post_mutation_state !== "absent") ||
        (backup.post_mutation_state === "present" &&
          (backup.post_mutation_revision === null || !/^[0-9a-f]{64}$/.test(backup.post_mutation_revision))) ||
        (backup.post_mutation_state === "absent" && backup.post_mutation_revision !== null)) {
      throw new Error("RESTORE_POSTCONDITION_UNKNOWN: restore requires an observed post-mutation state; historical overwrite is not supported");
    }
    if (backup.previous_state === "present" &&
        (!backup.previous_revision || !/^[0-9a-f]{64}$/.test(backup.previous_revision) ||
          sha256hex(backup.content) !== backup.previous_revision ||
          backup.content_hash !== backup.previous_revision)) {
      throw new Error("RESTORE_BACKUP_INTEGRITY_FAILURE: previous bytes cannot be verified");
    }

    // Revisions describe the bytes, not mtime: an absent target has no hash.
    // Reject directories and symlinks rather than interpreting them as files.
    async function currentState(): Promise<{kind: "absent"} | {kind: "present"; revision: string}> {
      let stat: fsSync.Stats;
      try { stat = await fs.lstat(filePath); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "absent" };
        throw error;
      }
      if (!stat.isFile()) throw new Error("RESTORE_REVISION_CONFLICT: target is no longer a regular file");
      await assertReadableSize(filePath);
      return { kind: "present", revision: sha256hex(await fs.readFile(filePath)) };
    }
    const matchesPrevious = (state: Awaited<ReturnType<typeof currentState>>): boolean =>
      backup.previous_state === state.kind &&
      (state.kind === "absent" || state.revision === backup.previous_revision);
    const matchesPost = (state: Awaited<ReturnType<typeof currentState>>): boolean =>
      backup.post_mutation_state === state.kind &&
      (state.kind === "absent" || state.revision === backup.post_mutation_revision);

    const observed = await currentState();
    // R4.01's absent-state repeat restore stays a safe no-op; do not overwrite
    // a later *different* revision simply because this backup was used once.
    if (matchesPrevious(observed)) {
      markFileBackupRestored(backupId);
      return {backupId, path: backup.path, restored: true, alreadyRestored: true, previousState: backup.previous_state};
    }
    if (!matchesPost(observed))
      throw new Error("RESTORE_REVISION_CONFLICT: target no longer matches the recorded post-mutation state");

    // Capture displaced bytes before the mutation (undo of the undo).
    // Check the state again after backup: if another writer changed it during
    // the backup, refuse restore rather than overwriting the detected change.
    const displacedBackupId = observed.kind === "present"
      ? await backupFile(filePath, backup.path, traceId) : undefined;
    if (!matchesPost(await currentState()))
      throw new Error("RESTORE_REVISION_CONFLICT: target changed while preparing restore");

    if (backup.previous_state === "absent") {
      await fs.unlink(filePath);
    } else {
      await fs.mkdir(path.dirname(filePath), {recursive: true});
      validateWorkspace(path.dirname(filePath));
      await atomicWrite(filePath, backup.content);
    }
    // Do not record a successful restoration or an observed displaced-backup
    // postcondition until the on-disk result is independently verified.
    if (!matchesPrevious(await currentState()))
      throw new Error("RESTORE_VERIFICATION_FAILED: restored target does not match previous snapshot state");
    if (displacedBackupId)
      recordFileBackupPostcondition(displacedBackupId, backup.previous_state,
        backup.previous_state === "present" ? backup.previous_revision! : undefined);
    markFileBackupRestored(backupId);
    return { backupId, displacedBackupId, path: backup.path, restored: true, alreadyRestored: false, previousState: backup.previous_state };
  });
}

export async function listWorkspaceDirectory(targetPath: string, correlationId?: string): Promise<string[]> {
  return audit("list", targetPath, correlationId, async () => {
    policyDecisionPoint.assertAllowed({ tool: "list_directory", arguments: { path: targetPath }, correlationId });
    const directory = validateWorkspace(targetPath);
    const entries = await fs.readdir(directory, { withFileTypes: true });
    if (entries.length > MAX_DIRECTORY_ENTRIES) throw new Error(`Directory exceeds ${MAX_DIRECTORY_ENTRIES} entry limit`);
    return entries.map((entry) => entry.isDirectory() ? `[DIR] ${entry.name}` : `[FILE] ${entry.name}`);
  });
}

export interface SearchMatch {
  /** File path relative to the search root */
  path: string;
  /** 1-based line number */
  line: number;
  /** Matching line text */
  text: string;
}

export interface SearchResult {
  query: string;
  root: string;
  matches: SearchMatch[];
  totalMatches: number;
  truncated: boolean;
}

export async function searchWorkspaceFiles(targetPath: string, query: string, correlationId?: string): Promise<SearchResult> {
  return workspaceSearchLimiter.run(() => audit("search", targetPath, correlationId, async () => {
    policyDecisionPoint.assertAllowed({ tool: "search_files", arguments: { path: targetPath, query }, correlationId });
    if (!query) throw new Error("Search query must not be empty");
    const root = validateWorkspace(targetPath);
    assertNotSensitive(root);
    const matches: SearchMatch[] = [];
    let truncated = false;
    const budget = new SearchBudgetMeter();
    async function walk(current: string): Promise<void> {
      budget.assertWithinTime();
      if (truncated) return;
      const entries = await fs.readdir(validateWorkspace(current), { withFileTypes: true });
      for (const entry of entries) {
        budget.assertWithinTime();
        if (truncated) return;
        const candidatePath = path.join(current, entry.name);
        // Exclude a sensitive directory BEFORE traversing or stat-ing children.
        if (isSensitivePath(candidatePath)) continue;
        const fullPath = validateWorkspace(candidatePath);
        if (isSensitiveCanonicalPath(fullPath)) continue;
        if (entry.isDirectory()) {
          if (!IGNORED_DIRECTORIES.has(entry.name)) await walk(fullPath);
          continue;
        }
        if (!entry.isFile()) continue;
        // Sensitive files are silently skipped, never returned as search hits —
        // their content must not leak through search lines (audit HIGH-02).
        if (isSensitiveSearchHit(fullPath)) continue;
        budget.recordFile();
        const stat = await fs.stat(fullPath);
        if (stat.size > MAX_FILE_BYTES) continue;
        budget.reserveBytes(stat.size);
        const content = await fs.readFile(fullPath, "utf8").catch(() => "");
        budget.reconcileRead(stat.size, Buffer.byteLength(content, "utf8"));
        if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) continue;
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(query)) {
            matches.push({
              path: path.relative(root, fullPath).replace(/\\/g, "/"),
              line: i + 1,
              // Cap per-line output so a huge single-line file cannot amplify
              // the result payload to megabytes per match.
              text: lines[i].length > MAX_SEARCH_LINE_BYTES
                ? lines[i].slice(0, MAX_SEARCH_LINE_BYTES) + "…[truncated]"
                : lines[i].trimEnd(),
            });
            if (budget.recordResult()) {
              truncated = true;
              return;
            }
          }
        }
      }
    }
    await walk(root);
    const selectedWorkspace = getActiveWorkspace();
    const relativeRoot = selectedWorkspace ? path.relative(selectedWorkspace, root) : "";
    // Search results are unprivileged; never serialize host absolute paths.
    const safeRoot = relativeRoot && !relativeRoot.startsWith("..") && !path.isAbsolute(relativeRoot)
      ? relativeRoot.replace(/\\/g, "/") : ".";
    return { query, root: safeRoot, matches, totalMatches: matches.length, truncated };
  }));
}