#!/usr/bin/env node
// Local SQLite migration + restore rehearsal on consistent online backups, NEVER on the live DB.
// Contains potentially sensitive data: artifacts are confined to ignored data/release-validation/.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { runMigrations, LATEST_MIGRATION_VERSION } from "../dist/core/memory/database/migrations.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.resolve(repo, process.env.HOOSHIX_DB_PATH ?? "data/agent-memory.db");
const outputDir = path.join(repo, "data", "release-validation");
const suffix = `${Date.now()}-${process.pid}`;
const target = path.join(outputDir, `migration-rehearsal-${suffix}.db`);
const restoredTarget = path.join(outputDir, `restore-rehearsal-${suffix}.db`);
let live, copy, restored;
try {
  if (!fs.existsSync(source)) throw new Error("Source database not found; cannot validate a representative copy");
  fs.mkdirSync(outputDir, { recursive: true });

  live = new Database(source, { readonly: true, fileMustExist: true });
  // SQLite online backup includes committed WAL state; never raw-copy an active .db file.
  await live.backup(target);
  live.close(); live = undefined;

  copy = new Database(target);
  copy.pragma("foreign_keys = ON");
  const integrityBefore = copy.pragma("integrity_check", { simple: true });
  if (integrityBefore !== "ok") throw new Error("Backup integrity check failed: " + integrityBefore);
  const before = copy.prepare("SELECT COUNT(*) AS count FROM tasks").get().count;

  runMigrations(copy);

  const integrityAfter = copy.pragma("integrity_check", { simple: true });
  const foreignKeyIssues = copy.pragma("foreign_key_check").length;
  const after = copy.prepare("SELECT COUNT(*) AS count FROM tasks").get().count;
  const schemaVersion = copy.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version;
  const roots = copy.prepare("SELECT COUNT(*) AS count FROM workspace_roots").get().count;
  if (integrityAfter !== "ok" || foreignKeyIssues || after !== before || schemaVersion !== LATEST_MIGRATION_VERSION) {
    throw new Error(`Copy validation failed: integrity=${integrityAfter}; foreignKeys=${foreignKeyIssues}; tasks=${before}->${after}; schema=${schemaVersion} (expected ${LATEST_MIGRATION_VERSION})`);
  }

  // Restore-drill: produce a second online backup from the migrated copy and
  // reopen it independently. This validates that the backup artifact itself is
  // usable without touching or replacing the primary live database.
  await copy.backup(restoredTarget);
  restored = new Database(restoredTarget, { readonly: true, fileMustExist: true });
  restored.pragma("foreign_keys = ON");
  const restoreIntegrity = restored.pragma("integrity_check", { simple: true });
  const restoreForeignKeyIssues = restored.pragma("foreign_key_check").length;
  const restoredTasks = restored.prepare("SELECT COUNT(*) AS count FROM tasks").get().count;
  const restoredSchemaVersion = restored.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version;
  if (restoreIntegrity !== "ok" || restoreForeignKeyIssues || restoredTasks !== after || restoredSchemaVersion !== schemaVersion) {
    throw new Error(`Restore drill failed: integrity=${restoreIntegrity}; foreignKeys=${restoreForeignKeyIssues}; tasks=${restoredTasks}; schema=${restoredSchemaVersion}`);
  }

  console.log(JSON.stringify({
    result: "PASS",
    sourceUnmodified: true,
    rehearsalCopy: target,
    restoreRehearsalCopy: restoredTarget,
    sensitiveCopiesTemporary: true,
    integrityBefore,
    integrityAfter,
    foreignKeyIssues,
    taskCountPreserved: before,
    persistedRootCount: roots,
    schemaVersion,
    restoreDrill: {
      result: "PASS",
      integrity: restoreIntegrity,
      foreignKeyIssues: restoreForeignKeyIssues,
      taskCount: restoredTasks,
      schemaVersion: restoredSchemaVersion
    }
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    result: "FAIL",
    reason: error instanceof Error ? error.message : String(error),
    rehearsalCopy: fs.existsSync(target) ? target : null,
    restoreRehearsalCopy: fs.existsSync(restoredTarget) ? restoredTarget : null,
    sourceUnmodified: true
  }, null, 2));
  process.exitCode = 1;
} finally {
  // Rehearsal databases contain live customer data. Never leave the backups,
  // including SQLite WAL/SHM sidecars, on disk after a run.
  const errors = [];
  for (const handle of [restored, copy, live]) {
    try { handle?.close(); } catch (error) { errors.push(String(error)); }
  }
  for (const file of [target, target + "-wal", target + "-shm",
                      restoredTarget, restoredTarget + "-wal", restoredTarget + "-shm"]) {
    try { fs.rmSync(file, {force: true}); }
    catch (error) { errors.push("remove rehearsal artifact: " + String(error)); }
  }
  const remaining = [target, target + "-wal", target + "-shm",
                     restoredTarget, restoredTarget + "-wal", restoredTarget + "-shm"]
                     .filter(file => fs.existsSync(file));
  if (errors.length || remaining.length) {
    process.exitCode = 1;
    console.error(JSON.stringify({kind: "release_rehearsal_cleanup",
      result: "FAIL", sensitiveArtifactsRemoved: false,
      remainingCount: remaining.length, errors}, null, 2));
  } else {
    console.log(JSON.stringify({kind: "release_rehearsal_cleanup",
      result: "PASS", sensitiveArtifactsRemoved: true,
      remainingCount: 0}, null, 2));
  }
}
