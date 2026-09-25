import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { readLegacyRuntimePaths } from "../../../../infrastructure/config/legacy-runtime-paths.js";
import { applyBaseSchemaMigration } from "./base-schema.migration.js";

let sharedDatabase: Database.Database | null = null;
let shutdownRegistered = false;

export function getAgentDatabasePath(): string {
  return path.resolve(readLegacyRuntimePaths().databasePath);
}

/**
 * H3 — a companion marker proving this location once held an initialized
 * database. `openAgentDatabase` previously re-created a missing file silently:
 * an operator (or a bad backup restore) could delete the database, and the
 * process would carry on with an EMPTY one, reporting a green readiness probe
 * while every task, grant and audit row was gone — the worst possible failure
 * mode, because nothing ever errored. Now a missing file plus a present marker
 * is a hard, loud error instead.
 */
function identityFilePath(databasePath: string): string {
  return `${databasePath}.identity`;
}

function readIdentity(databasePath: string): string | undefined {
  try {
    return fs.readFileSync(identityFilePath(databasePath), "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

function writeIdentity(databasePath: string): void {
  // "wx" refuses to overwrite; a concurrent process winning this race is fine,
  // the marker only needs to exist.
  try {
    fs.writeFileSync(identityFilePath(databasePath), randomUUID(), { flag: "wx" });
  } catch { /* already written by another process */ }
}

export function openAgentDatabase(): Database.Database {
  if (sharedDatabase) return sharedDatabase;

  const databasePath = getAgentDatabasePath();
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  const needsInitialization = !fs.existsSync(databasePath);
  if (needsInitialization && readIdentity(databasePath) !== undefined) {
    throw new Error(
      `Database file was removed after initialization: ${databasePath}. ` +
      "Restoring an empty database would silently report readiness with no data. " +
      "Restore it from backup, or delete the companion .identity file to acknowledge the loss and reinitialize.",
    );
  }
  const db = new Database(databasePath);
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");
    if (needsInitialization) {
      applyBaseSchemaMigration(db);
    }
    // Record that a database was initialized here, so a future deletion is
    // detected rather than silently papered over. Written for pre-existing
    // databases too, so upgrades get the same protection.
    writeIdentity(databasePath);
    // Restrict the file to its owner: it holds tasks, OAuth grants and audit
    // rows. Windows chmod only honours the writable bit (a harmless no-op
    // there), so this is POSIX hardening matching the 0600 contract already
    // enforced for the bootstrap token file. Best-effort: a filesystem that
    // cannot chmod must not block startup.
    try { fs.chmodSync(databasePath, 0o600); }
    catch (error) {
      console.error("Failed to restrict database file permissions:", error instanceof Error ? error.message : String(error));
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

/**
 * R9: executable SQL lives only in the SQLite adapters, never in transport or
 * application code. This is the readiness probe: it opens the shared
 * connection on first use (matching the historical lazy-initialization
 * behaviour of the HTTP readiness endpoint) and pings it. Returning false
 * rather than throwing lets the transport layer report 503 with no SQL.
 */
export function isDatabaseReady(): boolean {
  try {
    const db = openAgentDatabase();
    const row = db.prepare("SELECT 1 AS ok").get() as { ok: number } | undefined;
    return row?.ok === 1;
  } catch {
    return false;
  }
}

function registerShutdownHook(): void {
  if (shutdownRegistered) return;
  shutdownRegistered = true;
  // H2: this used to own SIGTERM/SIGINT and call process.exit(0), bypassing any
  // drain of in-flight HTTP requests. Signal handling now lives solely in
  // installGracefulShutdown (see infrastructure/server/graceful-shutdown.ts),
  // which closes the listener first and only then closes the database. This
  // hook remains as the last-resort cleanup on any other exit path.
  process.on("exit", () => { closeAgentDatabase(); });
}

