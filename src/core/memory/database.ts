import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const initializedDatabases = new Set<string>();
let sharedDatabase: Database.Database | null = null;

export function getAgentDatabasePath(): string {
  return path.resolve(process.env.HOOSHIX_DB_PATH ?? "./data/agent-memory.db");
}

const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  definition: string
): void {
  if (!SAFE_IDENTIFIER.test(table) || !SAFE_IDENTIFIER.test(column)) {
    throw new Error(`Invalid table or column name: ${table}.${column}`);
  }
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function migrate(db: Database.Database, version: number, name: string, operation: () => void): void {
  const applied = db.prepare("SELECT 1 FROM schema_migrations WHERE version = ?").get(version);
  if (applied) return;
  db.transaction(() => {
    operation();
    db.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)")
      .run(version, name, new Date().toISOString());
  })();
}

export function openAgentDatabase(): Database.Database {
  if (sharedDatabase) return sharedDatabase;

  const databasePath = getAgentDatabasePath();
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  const needsInitialization = !initializedDatabases.has(databasePath) || !fs.existsSync(databasePath);
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  sharedDatabase = db;
  registerShutdownHook();
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
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  migrate(db, 1, "legacy-columns-and-indexes", () => {
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
  });

  migrate(db, 2, "tool-call-observability", () => {
    ensureColumn(db, "tool_calls", "completed_at", "TEXT");
    ensureColumn(db, "tool_calls", "duration_ms", "INTEGER");
    ensureColumn(db, "tool_calls", "error", "TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_tool_calls_tool_status ON tool_calls(tool, status)");
  });

  migrate(db, 3, "package-snapshots", () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS package_snapshots (
        id TEXT PRIMARY KEY,
        correlation_id TEXT NOT NULL,
        manager TEXT NOT NULL,
        action TEXT NOT NULL,
        package_name TEXT NOT NULL,
        cwd TEXT NOT NULL,
        snapshot TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        restored_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_package_snapshots_correlation ON package_snapshots(correlation_id, created_at);
    `);
  });

  migrate(db, 4, "normalize-task-states", () => {
    db.prepare("UPDATE tasks SET status = 'planning' WHERE status = 'planned'").run();
    db.prepare("UPDATE tasks SET status = 'waiting_approval' WHERE status = 'paused'").run();
  });

  migrate(db, 5, "metrics-indexes", () => {
    // Covering indexes for metrics queries. Current benchmarks:
    //   COUNT(*) from tool_calls: ~0.03ms (covering scan via idx_tool_calls_correlation_id)
    //   GROUP BY tool WHERE status: ~0.16ms (covering scan via idx_tool_calls_tool_status)
    // Aggregation table (tool_metrics_daily) deferred — trigger: tool_calls > 100k rows
    // or metric query p95 > 50ms. At that point, create daily rollup table and
    // write triggers on tool_calls/recovery_events/executions to maintain it.
    db.exec("CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_recovery_status ON recovery_events(status)");
  });

  initializedDatabases.add(databasePath);
  return db;
}

export function closeAgentDatabase(): void {
  if (sharedDatabase) {
    sharedDatabase.close();
    sharedDatabase = null;
  }
}

let shutdownRegistered = false;
function registerShutdownHook(): void {
  if (shutdownRegistered) return;
  shutdownRegistered = true;
  const handler = () => { closeAgentDatabase(); };
  process.on("exit", handler);
  process.on("SIGINT", () => { closeAgentDatabase(); process.exit(0); });
  process.on("SIGTERM", () => { closeAgentDatabase(); process.exit(0); });
}

/** Reset the singleton connection. Used in tests to ensure isolation. */
export function resetAgentDatabase(): void {
  closeAgentDatabase();
}

export async function backupAgentDatabase(destination?: string): Promise<string> {
  const source = getAgentDatabasePath();
  const target = path.resolve(destination ?? path.join(path.dirname(source), "backups", `${path.basename(source)}.${new Date().toISOString().replace(/[:.]/g, "-")}.bak`));
  if (target === source) throw new Error("Database backup destination must differ from source");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const db = openAgentDatabase();
  await db.backup(target);
  return target;
}

export function cleanupAgentData(retentionDays = 90): Record<string, number> {
  if (!Number.isInteger(retentionDays) || retentionDays < 1) throw new Error("Retention must be a positive number of days");
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
  return withAgentDatabase((db) => db.transaction(() => ({
    toolCalls: db.prepare("DELETE FROM tool_calls WHERE created_at < ?").run(cutoff).changes,
    checkpoints: db.prepare("DELETE FROM agent_checkpoints WHERE created_at < ? AND task_id IN (SELECT id FROM tasks WHERE status IN ('completed','failed','cancelled'))").run(cutoff).changes,
    recoveryEvents: db.prepare("DELETE FROM recovery_events WHERE started_at < ? AND status != 'started'").run(cutoff).changes,
    approvals: db.prepare("DELETE FROM approval_requests WHERE created_at < ? AND status = 'consumed'").run(cutoff).changes,
    restoredBackups: db.prepare("DELETE FROM file_backups WHERE created_at < ? AND restored_at IS NOT NULL").run(cutoff).changes
  }))());
}

export function withAgentDatabase<T>(operation: (db: Database.Database) => T): T {
  const db = openAgentDatabase();
  return operation(db);
}
