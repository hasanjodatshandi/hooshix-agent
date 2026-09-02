import { beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const databasePath = path.resolve(process.env.HOOSHIX_DB_PATH ?? "./data/test-agent-memory.db");
const logDirectory = path.resolve(process.env.HOOSHIX_LOG_DIR ?? "./data/test-logs");
const memoryFile = path.resolve(process.env.HOOSHIX_MEMORY_FILE ?? "./data/test-agent-memory.json");

beforeEach(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(databasePath + suffix, { force: true });
  fs.rmSync(logDirectory, { recursive: true, force: true });
  fs.rmSync(memoryFile, { force: true });
});
