import { beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { resetAgentDatabase } from "../../src/core/memory/database.js";

const databasePath = path.resolve(process.env.HOOSHIX_DB_PATH ?? "./data/test-agent-memory.db");
const logDirectory = path.resolve(process.env.HOOSHIX_LOG_DIR ?? "./data/test-logs");
const memoryFile = path.resolve(process.env.HOOSHIX_MEMORY_FILE ?? "./data/test-agent-memory.json");

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
  for (const suffix of ["", "-wal", "-shm"]) rmSyncWithRetry(databasePath + suffix, { force: true });
  fs.rmSync(logDirectory, { recursive: true, force: true });
  fs.rmSync(memoryFile, { force: true });
});
