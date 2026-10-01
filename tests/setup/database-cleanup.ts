import { afterAll, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { resetAgentDatabase, resetMigrationsFlag } from "../../src/core/memory/database/index.js";
import { resetColumnsFlag } from "../../src/core/memory/task-repository.js";
import { resetRecoveryTaskIdFlag } from "../../src/core/trace/recovery-repository.js";
import { replaceWorkspaceRoots } from "../../src/security/workspace-guard.js";

// R8.06: parallel Vitest workers must never share one SQLite/log/memory tree.
// A single shared repo-relative database lets one worker's beforeEach delete
// another worker's open database (EPERM on Windows, an orphaned connection on
// POSIX), which is the whole-suite parallel failure root cause. Each worker
// resolves its own paths from VITEST_WORKER_ID, so no worker can touch another
// worker's open database. Setup files run before any test module imports, so
// every lazy config read observes the isolated path.
const workerId = process.env.VITEST_WORKER_ID ?? "single";
process.env.HOOSHIX_DB_PATH = path.resolve("data", `test-agent-memory-${workerId}.db`);
process.env.HOOSHIX_LOG_DIR = path.resolve("data", `test-logs-${workerId}`);
process.env.HOOSHIX_MEMORY_FILE = path.resolve("data", `test-agent-memory-${workerId}.json`);

const databasePath = path.resolve(process.env.HOOSHIX_DB_PATH);
const logDirectory = path.resolve(process.env.HOOSHIX_LOG_DIR);
const memoryFile = path.resolve(process.env.HOOSHIX_MEMORY_FILE);

function rmSyncWithRetry(filePath: string, options?: fs.RmOptions): void {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.rmSync(filePath, options);
      return;
    } catch (error: any) {
      if (error?.code !== "EBUSY" || attempt === 4) throw error;
      // Busy wait briefly for Windows SQLite WAL file lock release
      const start = performance.now();
      while (performance.now() - start < 50) { /* spin */ }
    }
  }
}

beforeEach(() => {
  resetAgentDatabase();
  resetMigrationsFlag();
  resetColumnsFlag();
  resetRecoveryTaskIdFlag();
  for (const suffix of ["", "-wal", "-shm", ".identity"]) rmSyncWithRetry(databasePath + suffix, { force: true });
  fs.rmSync(logDirectory, { recursive: true, force: true });
  fs.rmSync(memoryFile, { force: true });
  replaceWorkspaceRoots(process.cwd());
});

// OPS-01: beforeEach isolates each test but nothing reclaimed the worker's tree
// after the run, so data/ accumulated hundreds of leftover test databases. Each
// worker owns exactly its own VITEST_WORKER_ID paths (no other worker touches
// them), so removing them here is safe and keeps the working tree clean.
// The connection is closed first: on Windows an open SQLite handle makes the
// file undeletable (EPERM) and would fail the suite in teardown. Deletion is
// best-effort — a leftover file is only disk clutter, never a test failure.
afterAll(() => {
  resetAgentDatabase();
  for (const suffix of ["", "-wal", "-shm", ".identity"]) {
    try { rmSyncWithRetry(databasePath + suffix, { force: true }); } catch { /* best-effort teardown */ }
  }
  try { fs.rmSync(logDirectory, { recursive: true, force: true }); } catch { /* best-effort teardown */ }
  try { fs.rmSync(memoryFile, { force: true }); } catch { /* best-effort teardown */ }
});
