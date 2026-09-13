import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { validateWorkspace } from "../../security/workspace-guard.js";
import { policyDecisionPoint } from "../../core/governance/policy-decision-point.js";
import { logFileAction } from "../../memory/file-audit.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";
import { withAgentDatabase } from "../../core/memory/database.js";

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_SEARCH_RESULTS = 1000;
const MAX_SEARCH_FILES = 10000;
const MAX_SEARCH_LINE_BYTES = 512;
const MAX_DIRECTORY_ENTRIES = 5000;
const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", "coverage", "data", "logs"]);

/**
 * Sensitive file denylist: basenames (any directory) and path suffixes the agent
 * must never read, write, or exfiltrate via read_file/search_files. Blocking at
 * the service layer so both direct MCP calls and task steps are covered.
 */
const SENSITIVE_BASENAMES = new Set([
  ".token", ".env", ".env.local", ".env.development", ".env.production",
  ".env.staging", ".env.test", "id_rsa", "id_ecdsa", "id_ed25519", "id_dsa",
  ".npmrc", ".pypirc", ".netrc", ".htpasswd", "credentials.json",
  "secrets.json", "secrets.yaml", "secrets.yml",
]);
const SENSITIVE_EXTENSIONS = new Set([".pem", ".key", ".pfx", ".p12", ".kdbx"]);
const SENSITIVE_DIRS = [".ssh", ".gnupg", ".aws", ".azure"];

function isSensitivePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  const basename = normalized.slice(normalized.lastIndexOf("/") + 1);
  if (SENSITIVE_BASENAMES.has(basename)) return true;
  const segments = normalized.split("/").filter(Boolean);
  if (segments.some((segment) => SENSITIVE_DIRS.includes(segment))) return true;
  const dot = basename.lastIndexOf(".");
  if (dot > 0 && SENSITIVE_EXTENSIONS.has(basename.slice(dot))) return true;
  // .env.* (e.g. .env.docker)
  if (basename.startsWith(".env.")) return true;
  return false;
}

function assertNotSensitive(filePath: string): void {
  if (isSensitivePath(filePath)) {
    throw new Error(`Access denied: ${filePath} matches the sensitive-file denylist (credentials, keys, or tokens)`);
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
  /** Whether a file was newly created (was previously absent) */
  created?: boolean;
  /** Whether the file existed before this operation */
  previousState?: "present" | "absent";
  /** Number of occurrences replaced by modify_file */
  replacedOccurrences?: number;
}

async function audit<T>(action: string, targetPath: string, correlationId: string | undefined, operation: (traceId: string) => Promise<T>): Promise<T> {
  const traceId = resolveCorrelationId(correlationId);
  try {
    const result = await operation(traceId);
    await logFileAction(action, targetPath, traceId, "success");
    return result;
  } catch (error) {
    await logFileAction(action, targetPath, traceId, "failed");
    throw error;
  }
}

async function assertReadableSize(filePath: string): Promise<void> {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error("Target is not a file");
  if (stat.size > MAX_FILE_BYTES) throw new Error(`File exceeds ${MAX_FILE_BYTES} byte limit`);
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
    await fs.rename(temporary, filePath);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function backupFile(filePath: string, _targetPath: string, correlationId: string): Promise<string> {
  await assertReadableSize(filePath);
  const id = randomUUID();
  const content = await fs.readFile(filePath);
  const contentStr = content.toString("utf8");
  const sha256 = sha256hex(contentStr);
  // Store the CANONICAL absolute path, never the raw caller string. A raw
  // relative path would be re-resolved against whatever workspace is active
  // at restore time — materializing the file in the WRONG workspace
  // (defect FS-01, a workspace-isolation break).
  const canonical = validateWorkspace(filePath);
  withAgentDatabase((db) => {
    try {
      db.prepare(`
        INSERT INTO file_backups(id, correlation_id, path, content, created_at, file_revision)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, correlationId, canonical, content, new Date().toISOString(), sha256);
    } catch {
      // Fallback if file_revision column doesn't exist yet
      db.prepare(`
        INSERT INTO file_backups(id, correlation_id, path, content, created_at) VALUES (?, ?, ?, ?, ?)
      `).run(id, correlationId, canonical, content, new Date().toISOString());
    }
  });
  return id;
}

/** Compute SHA-256 hex digest of a string. */
function sha256hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
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
  return withAgentDatabase((db) => {
    const row = db.prepare(
      "SELECT response FROM idempotency_responses WHERE id = ? AND operation = ? AND request_hash = ?"
    ).get(idempotencyKey, operation, requestHash) as { response: string } | undefined;
    return row ? JSON.parse(row.response) as unknown : undefined;
  });
}

/**
 * Store an idempotent response for future deduplication.
 */
function storeIdempotentResponse(idempotencyKey: string, operation: string, requestHash: string, response: unknown): void {
  withAgentDatabase((db) => {
    db.prepare(
      "INSERT OR IGNORE INTO idempotency_responses(id, operation, request_hash, response, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(idempotencyKey, operation, requestHash, JSON.stringify(response), new Date().toISOString());
  });
}

export async function readWorkspaceFile(targetPath: string, correlationId?: string, options?: { includeSha256?: boolean }): Promise<string | { content: string; sha256: string }> {
  return audit("read", targetPath, correlationId, async () => {
    policyDecisionPoint.assertAllowed({ tool: "read_file", arguments: { path: targetPath }, correlationId });
    const filePath = validateWorkspace(targetPath);
    assertNotSensitive(filePath);
    await assertReadableSize(filePath);
    const content = await fs.readFile(filePath, "utf8");
    if (options?.includeSha256) return { content, sha256: sha256hex(content) };
    return content;
  });
}

export async function createWorkspaceFile(targetPath: string, content: string, correlationId?: string): Promise<FileMutationResult> {
  return audit("create", targetPath, correlationId, async () => {
    policyDecisionPoint.assertAllowed({ tool: "create_file", arguments: { path: targetPath }, correlationId });
    if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) throw new Error(`Content exceeds ${MAX_FILE_BYTES} byte limit`);
    const filePath = validateWorkspace(targetPath);
    assertNotSensitive(filePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    validateWorkspace(path.dirname(filePath));
    // Atomic create like write_file: temp file + rename so a crash never leaves a partial file
    await atomicWrite(filePath, content, { flag: "wx" });
    return { path: targetPath, created: true, previousState: "absent" as const };
  });
}

async function saveAbsentSnapshot(targetPath: string, correlationId: string): Promise<string> {
  const id = randomUUID();
  // Canonical absolute path only — same isolation rule as backupFile (FS-01):
  // a relative snapshot path would re-resolve against the active workspace at
  // restore time and materialize in the wrong workspace.
  const canonical = validateWorkspace(targetPath);
  withAgentDatabase((db) => db.prepare(`
    INSERT INTO file_backups(id, correlation_id, path, content, created_at) VALUES (?, ?, ?, ?, ?)
  `).run(id, correlationId, canonical, Buffer.alloc(0), new Date().toISOString()));
  // Mark this backup as an absent-state snapshot
  withAgentDatabase((db) => db.prepare(
    "UPDATE file_backups SET restored_at = 'absent' WHERE id = ?"
  ).run(id));
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
    const result = { backupId, path: targetPath, previousState: "present" as const };
    if (options?.idempotencyKey) {
      storeIdempotentResponse(options.idempotencyKey, "delete", normalizeRequest(targetPath), result);
    }
    return result;
  });
}

export async function restoreWorkspaceFile(backupId: string, correlationId?: string): Promise<FileMutationResult> {
  return audit("restore", backupId, correlationId, async (traceId) => {
    policyDecisionPoint.assertAllowed({ tool: "restore_file", arguments: { backupId }, correlationId });
    const backup = withAgentDatabase((db) => db.prepare(`
      SELECT id, path, content, restored_at FROM file_backups WHERE id = ?
    `).get(backupId) as { id: string; path: string; content: Buffer; restored_at: string | null } | undefined);
    if (!backup) throw new Error("Backup not found");
    // Workspace isolation (defect FS-01): the stored path is canonical and
    // absolute, but it was captured in a DIFFERENT active workspace. Re-validating
    // is not enough — a relative legacy row would silently re-resolve into the
    // current workspace, and an absolute row from another root would be written
    // outside the active scope. Fail closed: the backup's path must resolve
    // inside the CURRENT active workspace, otherwise the restore is refused.
    let filePath: string;
    try {
      filePath = validateWorkspace(backup.path);
    } catch {
      throw new Error(
        `Access denied: backup ${backupId} targets '${backup.path}' which is outside the active workspace. ` +
        `Backups can only be restored in the workspace they were taken in — set_workspace back to the original workspace first.`
      );
    }
    // Defense-in-depth: a legacy row with a RELATIVE path must never be
    // re-anchored into the current workspace. Canonical storage is absolute;
    // if the stored path still isn't absolute, the row predates the fix and
    // cannot be proven to belong to this workspace — reject rather than guess.
    if (!path.isAbsolute(backup.path)) {
      throw new Error(
        `Access denied: backup ${backupId} has a non-canonical (relative) path and cannot be proven to belong to the active workspace. Restore refused.`
      );
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    // Check if this is an absent-state snapshot (restored_at = 'absent')
    const isAbsentSnapshot = backup.restored_at === "absent";

    if (isAbsentSnapshot) {
      // Restore to absent state — delete the file if it exists.
      // IMPORTANT: back up the displaced content first so "undo of the undo"
      // stays possible — previously this rm'd the current file with no backup.
      const displacedBackupId = await fs.access(filePath).then(() => backupFile(filePath, backup.path, traceId), () => undefined);
      await fs.rm(filePath, { force: true });
      withAgentDatabase((db) => db.prepare("UPDATE file_backups SET restored_at=? WHERE id=?").run(new Date().toISOString(), backupId));
      return { backupId, displacedBackupId, path: backup.path, restored: true, previousState: "absent" };
    }

    // Normal restore — write the backed-up content
    const displacedBackupId = await fs.access(filePath).then(() => backupFile(filePath, backup.path, traceId), () => undefined);
    await atomicWrite(filePath, backup.content);
    withAgentDatabase((db) => db.prepare("UPDATE file_backups SET restored_at=? WHERE id=?").run(new Date().toISOString(), backupId));
    return { backupId, displacedBackupId, path: backup.path, restored: true, previousState: "present" };
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
  /** Absolute file path */
  absolutePath: string;
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
  return audit("search", targetPath, correlationId, async () => {
    policyDecisionPoint.assertAllowed({ tool: "search_files", arguments: { path: targetPath, query }, correlationId });
    if (!query) throw new Error("Search query must not be empty");
    const root = validateWorkspace(targetPath);
    const matches: SearchMatch[] = [];
    let truncated = false;
    let scannedFiles = 0;
    async function walk(current: string): Promise<void> {
      if (truncated) return;
      const entries = await fs.readdir(validateWorkspace(current), { withFileTypes: true });
      for (const entry of entries) {
        if (truncated) return;
        const fullPath = validateWorkspace(path.join(current, entry.name));
        if (entry.isDirectory()) {
          if (!IGNORED_DIRECTORIES.has(entry.name)) await walk(fullPath);
          continue;
        }
        if (!entry.isFile()) continue;
        // Sensitive files are silently skipped, never returned as search hits —
        // their content must not leak through search lines (audit HIGH-02).
        if (isSensitiveSearchHit(fullPath)) continue;
        if (++scannedFiles > MAX_SEARCH_FILES) throw new Error(`Search exceeds ${MAX_SEARCH_FILES} file limit`);
        const stat = await fs.stat(fullPath);
        if (stat.size > MAX_FILE_BYTES) continue;
        const content = await fs.readFile(fullPath, "utf8").catch(() => "");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(query)) {
            matches.push({
              path: path.relative(root, fullPath).replace(/\\/g, "/"),
              absolutePath: fullPath.replace(/\\/g, "/"),
              line: i + 1,
              // Cap per-line output so a huge single-line file cannot amplify
              // the result payload to megabytes per match.
              text: lines[i].length > MAX_SEARCH_LINE_BYTES
                ? lines[i].slice(0, MAX_SEARCH_LINE_BYTES) + "…[truncated]"
                : lines[i].trimEnd(),
            });
            if (matches.length >= MAX_SEARCH_RESULTS) {
              truncated = true;
              return;
            }
          }
        }
      }
    }
    await walk(root);
    return { query, root: root.replace(/\\/g, "/"), matches, totalMatches: matches.length, truncated };
  });
}
