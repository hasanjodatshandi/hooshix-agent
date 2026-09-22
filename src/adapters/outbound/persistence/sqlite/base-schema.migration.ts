import type Database from "better-sqlite3";

/** Version 0: baseline schema for a newly created SQLite file only.
 * Historical databases without this marker retain their existing migration history. */
export function applyBaseSchemaMigration(db:Database.Database):void{
  db.transaction(()=>{
    db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      correlation_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT,
      step_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      result TEXT,
      status TEXT NOT NULL DEFAULT 'completed',
      correlation_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT,
      reason TEXT NOT NULL,
      action TEXT NOT NULL,
      correlation_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_checkpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      step_id INTEGER NOT NULL,
      step_index INTEGER NOT NULL,
      state TEXT NOT NULL,
      correlation_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS approval_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      step_id INTEGER NOT NULL,
      action TEXT,
      risk TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL,
      correlation_id TEXT,
      created_at TEXT NOT NULL,
      approved_at TEXT,
      consumed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS recovery_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recovery_id TEXT NOT NULL,
      correlation_id TEXT NOT NULL,
      action TEXT NOT NULL,
      reason TEXT NOT NULL,
      retry_count INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tool_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      correlation_id TEXT NOT NULL,
      task_id TEXT,
      tool TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS task_steps (
      task_id TEXT NOT NULL,
      step_id INTEGER NOT NULL,
      step_order INTEGER NOT NULL,
      action TEXT NOT NULL,
      tool TEXT,
      input TEXT NOT NULL DEFAULT '{}',
      dependencies TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL,
      output TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (task_id, step_id),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      description TEXT,
      last_action TEXT,
      next_action TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT,
      task_id TEXT,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS file_backups (
      id TEXT PRIMARY KEY,
      correlation_id TEXT NOT NULL,
      path TEXT NOT NULL,
      content BLOB NOT NULL,
      created_at TEXT NOT NULL,
      restored_at TEXT
    );
    CREATE TABLE IF NOT EXISTS idempotency_responses (
      id TEXT NOT NULL,
      operation TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      response TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (id, operation, request_hash)
    );
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
    db.prepare("INSERT INTO schema_migrations(version,name,applied_at) VALUES(0,?,?)")
      .run("r6-initial-schema",new Date().toISOString());
  })();
}
