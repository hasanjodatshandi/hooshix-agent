import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { readLegacyRuntimePaths } from "../../../../infrastructure/config/legacy-runtime-paths.js";
import { applyBaseSchemaMigration } from "./base-schema.migration.js";

let sharedDatabase: Database.Database | null = null;
let shutdownRegistered = false;

export function getAgentDatabasePath(): string {
  return path.resolve(readLegacyRuntimePaths().databasePath);
}

export function openAgentDatabase(): Database.Database {
  if (sharedDatabase) return sharedDatabase;

  const databasePath = getAgentDatabasePath();
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  const needsInitialization = !fs.existsSync(databasePath);
  const db = new Database(databasePath);
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");
    if (needsInitialization) {
      applyBaseSchemaMigration(db);
    }
  } catch (error) {
    db.close();
    throw error;
  }

  sharedDatabase = db;
  registerShutdownHook();
  return db;
}

export function closeAgentDatabase(): void {
  if (sharedDatabase) {
    sharedDatabase.close();
    sharedDatabase = null;
  }
}

/** Reset the singleton connection. Used in tests to ensure isolation. */
export function resetAgentDatabase(): void {
  closeAgentDatabase();
}

function registerShutdownHook(): void {
  if (shutdownRegistered) return;
  shutdownRegistered = true;
  const handler = () => { closeAgentDatabase(); };
  process.on("exit", handler);
  process.on("SIGINT", () => { closeAgentDatabase(); process.exit(0); });
  process.on("SIGTERM", () => { closeAgentDatabase(); process.exit(0); });
}

