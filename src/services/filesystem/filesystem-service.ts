import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { validateWorkspace } from "../../security/workspace-guard.js";
import { assertToolPermission } from "../../security/permission.js";
import { logFileAction } from "../../memory/file-audit.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";
import { withAgentDatabase } from "../../core/memory/database.js";

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_SEARCH_RESULTS = 1000;
const MAX_SEARCH_FILES = 10000;
const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", "coverage", "data", "logs"]);

export interface FileMutationResult { backupId?: string }

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

async function atomicWrite(filePath: string, content: string | Buffer): Promise<void> {
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, content, { flag: "wx" });
    await fs.rename(temporary, filePath);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function backupFile(filePath: string, targetPath: string, correlationId: string): Promise<string> {
  await assertReadableSize(filePath);
  const id = randomUUID();
  const content = await fs.readFile(filePath);
  withAgentDatabase((db) => db.prepare(`
    INSERT INTO file_backups(id, correlation_id, path, content, created_at) VALUES (?, ?, ?, ?, ?)
  `).run(id, correlationId, targetPath, content, new Date().toISOString()));
  return id;
}

export async function readWorkspaceFile(targetPath: string, correlationId?: string): Promise<string> {
  return audit("read", targetPath, correlationId, async () => {
    assertToolPermission("read_file");
    const filePath = validateWorkspace(targetPath);
    await assertReadableSize(filePath);
    return fs.readFile(filePath, "utf8");
  });
}

export async function createWorkspaceFile(targetPath: string, content: string, correlationId?: string): Promise<FileMutationResult> {
  return audit("create", targetPath, correlationId, async () => {
    assertToolPermission("create_file");
    if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) throw new Error(`Content exceeds ${MAX_FILE_BYTES} byte limit`);
    const filePath = validateWorkspace(targetPath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    validateWorkspace(path.dirname(filePath));
    await fs.writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
    return {};
  });
}

export async function writeWorkspaceFile(targetPath: string, content: string, correlationId?: string): Promise<FileMutationResult> {
  return audit("write", targetPath, correlationId, async (traceId) => {
    assertToolPermission("write_file");
    if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) throw new Error(`Content exceeds ${MAX_FILE_BYTES} byte limit`);
    const filePath = validateWorkspace(targetPath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    validateWorkspace(path.dirname(filePath));
    const backupId = await fs.access(filePath).then(() => backupFile(filePath, targetPath, traceId), () => undefined);
    await atomicWrite(filePath, content);
    return { backupId };
  });
}

export async function modifyWorkspaceFile(targetPath: string, search: string, replacement: string, correlationId?: string): Promise<FileMutationResult> {
  return audit("modify", targetPath, correlationId, async (traceId) => {
    assertToolPermission("modify_file");
    if (!search) throw new Error("Search text must not be empty");
    const filePath = validateWorkspace(targetPath);
    await assertReadableSize(filePath);
    const content = await fs.readFile(filePath, "utf8");
    if (!content.includes(search)) throw new Error("Target text was not found");
    const updated = content.replace(search, replacement);
    if (Buffer.byteLength(updated, "utf8") > MAX_FILE_BYTES) throw new Error(`Content exceeds ${MAX_FILE_BYTES} byte limit`);
    const backupId = await backupFile(filePath, targetPath, traceId);
    await atomicWrite(filePath, updated);
    return { backupId };
  });
}

export async function deleteWorkspaceFile(targetPath: string, correlationId?: string): Promise<FileMutationResult> {
  return audit("delete", targetPath, correlationId, async (traceId) => {
    assertToolPermission("delete_file");
    const filePath = validateWorkspace(targetPath);
    const backupId = await backupFile(filePath, targetPath, traceId);
    await fs.unlink(filePath);
    return { backupId };
  });
}

export async function restoreWorkspaceFile(backupId: string, correlationId?: string): Promise<FileMutationResult> {
  return audit("restore", backupId, correlationId, async (traceId) => {
    assertToolPermission("restore_file");
    const backup = withAgentDatabase((db) => db.prepare(`
      SELECT id, path, content FROM file_backups WHERE id = ?
    `).get(backupId) as { id: string; path: string; content: Buffer } | undefined);
    if (!backup) throw new Error("Backup not found");
    const filePath = validateWorkspace(backup.path);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const displacedBackupId = await fs.access(filePath).then(() => backupFile(filePath, backup.path, traceId), () => undefined);
    await atomicWrite(filePath, backup.content);
    withAgentDatabase((db) => db.prepare("UPDATE file_backups SET restored_at=? WHERE id=?").run(new Date().toISOString(), backupId));
    return { backupId: displacedBackupId };
  });
}

export async function listWorkspaceDirectory(targetPath: string, correlationId?: string): Promise<string[]> {
  return audit("list", targetPath, correlationId, async () => {
    assertToolPermission("list_directory");
    const directory = validateWorkspace(targetPath);
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries.map((entry) => entry.isDirectory() ? `[DIR] ${entry.name}` : `[FILE] ${entry.name}`);
  });
}

export async function searchWorkspaceFiles(targetPath: string, query: string, correlationId?: string): Promise<string[]> {
  return audit("search", targetPath, correlationId, async () => {
    assertToolPermission("search_files");
    if (!query) throw new Error("Search query must not be empty");
    const root = validateWorkspace(targetPath);
    const workspace = validateWorkspace(".");
    const results: string[] = [];
    let scannedFiles = 0;
    async function walk(current: string): Promise<void> {
      if (results.length >= MAX_SEARCH_RESULTS) return;
      const entries = await fs.readdir(validateWorkspace(current), { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= MAX_SEARCH_RESULTS) return;
        const fullPath = validateWorkspace(path.join(current, entry.name));
        if (entry.isDirectory()) {
          if (!IGNORED_DIRECTORIES.has(entry.name)) await walk(fullPath);
          continue;
        }
        if (!entry.isFile()) continue;
        if (++scannedFiles > MAX_SEARCH_FILES) throw new Error(`Search exceeds ${MAX_SEARCH_FILES} file limit`);
        const stat = await fs.stat(fullPath);
        if (stat.size > MAX_FILE_BYTES) continue;
        const content = await fs.readFile(fullPath, "utf8").catch(() => "");
        if (content.includes(query)) results.push(path.relative(workspace, fullPath));
      }
    }
    await walk(root);
    return results;
  });
}
