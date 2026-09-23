import { openAgentDatabase } from "./connection.js";
import { runMigrations } from "./migrations.js";

// Re-export connection lifecycle
export {
  getAgentDatabasePath,
  openAgentDatabase,
  closeAgentDatabase,
  resetAgentDatabase,
  isDatabaseReady,
} from "./connection.js";

// Re-export migrations
export { ensureColumn, migrate, runMigrations } from "./migrations.js";

// Re-export backup
export { backupAgentDatabase } from "./backup.js";

// Re-export cleanup
export { cleanupAgentData } from "./cleanup.js";

let migrationsApplied = false;

/** Test hook: forget applied migrations after resetAgentDatabase(). */
export function resetMigrationsFlag(): void {
  migrationsApplied = false;
}

/**
 * Convenience wrapper — opens the shared database and runs the operation.
 * Migrations run ONCE per process (at first DB access), not on every call:
 * withAgentDatabase is invoked thousands of times per task run and the
 * previous per-call runMigrations added 5 redundant SELECTs each time.
 */
export function withAgentDatabase<T>(operation: (db: import("better-sqlite3").Database) => T): T {
  const db = openAgentDatabase();
  if (!migrationsApplied) {
    runMigrations(db);
    migrationsApplied = true;
  }
  return operation(db);
}
