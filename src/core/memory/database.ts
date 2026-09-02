import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const initializedDatabases = new Set<string>();

export function getAgentDatabasePath(): string {
  return path.resolve(process.env.HOOSHIX_DB_PATH ?? "./data/agent-memory.db");
}

function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  definition: string
): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function openAgentDatabase(): Database.Database {
  const databasePath = getAgentDatabasePath();
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  const needsInitialization = !initializedDatabases.has(databasePath) || !fs.existsSync(databasePath);
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  if (!needsInitialization) return db;
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
  `);

  // Migrations for databases created by earlier development phases.
  ensureColumn(db, "tasks", "correlation_id", "TEXT");
  ensureColumn(db, "tasks", "title", "TEXT");
  ensureColumn(db, "executions", "task_id", "TEXT");
  ensureColumn(db, "executions", "status", "TEXT NOT NULL DEFAULT 'completed'");
  ensureColumn(db, "executions", "correlation_id", "TEXT");
  ensureColumn(db, "decisions", "correlation_id", "TEXT");
  ensureColumn(db, "approval_requests", "action", "TEXT");
  ensureColumn(db, "approval_requests", "consumed_at", "TEXT");

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tasks_correlation_id ON tasks(correlation_id);
    CREATE INDEX IF NOT EXISTS idx_executions_task_id ON executions(task_id);
    CREATE INDEX IF NOT EXISTS idx_executions_correlation_id ON executions(correlation_id);
    CREATE INDEX IF NOT EXISTS idx_decisions_correlation_id ON decisions(correlation_id);
    CREATE INDEX IF NOT EXISTS idx_checkpoints_task_id ON agent_checkpoints(task_id, id);
    CREATE INDEX IF NOT EXISTS idx_checkpoints_correlation_id ON agent_checkpoints(correlation_id);
    CREATE INDEX IF NOT EXISTS idx_approvals_correlation_id ON approval_requests(correlation_id);
    CREATE INDEX IF NOT EXISTS idx_recovery_correlation_id ON recovery_events(correlation_id, id);
    CREATE INDEX IF NOT EXISTS idx_recovery_id ON recovery_events(recovery_id, id);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_correlation_id ON tool_calls(correlation_id, id);
    CREATE INDEX IF NOT EXISTS idx_task_steps_task_order ON task_steps(task_id, step_order);
    CREATE INDEX IF NOT EXISTS idx_memory_items_task_id ON memory_items(task_id, id);
    CREATE INDEX IF NOT EXISTS idx_file_backups_path ON file_backups(path, created_at);
  `);

  initializedDatabases.add(databasePath);
  return db;
}

export function withAgentDatabase<T>(operation: (db: Database.Database) => T): T {
  const db = openAgentDatabase();
  try {
    return operation(db);
  } finally {
    db.close();
  }
}
