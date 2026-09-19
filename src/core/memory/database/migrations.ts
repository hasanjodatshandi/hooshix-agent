import type Database from "better-sqlite3";

const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  if (!SAFE_IDENTIFIER.test(table) || !SAFE_IDENTIFIER.test(column)) {
    throw new Error(`Invalid table or column name: ${table}.${column}`);
  }
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function migrate(
  db: Database.Database,
  version: number,
  name: string,
  operation: () => void,
): void {
  const applied = db.prepare("SELECT 1 FROM schema_migrations WHERE version = ?").get(version);
  if (applied) return;
  db.transaction(() => {
    operation();
    db.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)")
      .run(version, name, new Date().toISOString());
  })();
}

export function runMigrations(db: Database.Database): void {
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
    db.exec("CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_recovery_status ON recovery_events(status)");
  });
  migrate(db, 6, "workspace-persistence-v1", () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_roots (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        normalized_path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_workspace_roots_normalized_path
        ON workspace_roots(normalized_path);
    `);
  });

  migrate(db, 7, "durable-task-contract-v1", () => {
    ensureColumn(db, "tasks", "last_heartbeat", "TEXT");
    ensureColumn(db, "tasks", "execution_context", "TEXT");
    ensureColumn(db, "tasks", "max_recovery", "INTEGER");
    ensureColumn(db, "tasks", "retry_policy", "TEXT");
    ensureColumn(db, "tasks", "total_run_count", "INTEGER DEFAULT 0");
    ensureColumn(db, "tasks", "idempotency_key", "TEXT");

    ensureColumn(db, "task_steps", "error_type", "TEXT");
    ensureColumn(db, "task_steps", "run_when", "TEXT DEFAULT 'success'");
    ensureColumn(db, "task_steps", "step_timeout_ms", "INTEGER");
    ensureColumn(db, "task_steps", "attempts", "INTEGER DEFAULT 0");
    ensureColumn(db, "task_steps", "failed_attempts", "INTEGER DEFAULT 0");
    ensureColumn(db, "task_steps", "attempt_history", "TEXT");
    ensureColumn(db, "task_steps", "template_arguments", "TEXT");

    ensureColumn(db, "file_backups", "file_revision", "TEXT");
    ensureColumn(db, "projects", "status", "TEXT DEFAULT 'active'");

    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_idempotency_key
        ON tasks(idempotency_key) WHERE idempotency_key IS NOT NULL;
      CREATE TABLE IF NOT EXISTS task_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_task_id TEXT NOT NULL,
        target_task_id TEXT NOT NULL,
        relation TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (source_task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (target_task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_task_links_source ON task_links(source_task_id, id);
      CREATE INDEX IF NOT EXISTS idx_task_links_target ON task_links(target_task_id, id);
    `);
  });

  migrate(db, 8, "observability-schema-v1", () => {
    ensureColumn(db, "tool_calls", "category", "TEXT DEFAULT 'workflow'");
    ensureColumn(db, "recovery_events", "task_id", "TEXT");
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tool_calls_category_created_at
        ON tool_calls(category, created_at);
      CREATE INDEX IF NOT EXISTS idx_recovery_events_task_started
        ON recovery_events(task_id, started_at);
    `);
  });
}
