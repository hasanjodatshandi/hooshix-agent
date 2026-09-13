import type { TaskPlan, TaskStep, TaskStepStatus, TaskExecutionContext, StepAttempt } from "../planner/task-planner.js";
import type { TaskState } from "../state/task-state-machine.js";
import { withAgentDatabase } from "./database.js";
import path from "node:path";

interface TaskRow {
  id: string;
  title: string | null;
  description: string;
  correlation_id: string | null;
  status: TaskState;
  execution_context?: string | null;
  max_recovery?: number | null;
}

interface StepRow {
  step_id: number;
  action: string;
  tool: TaskStep["tool"] | null;
  input: string;
  dependencies: string;
  status: TaskStepStatus;
  output: string | null;
  error: string | null;
  error_type: string | null;
}

function parseJson(value: string | null, fallback: unknown): unknown {
  if (value === null) return fallback;
  try { return JSON.parse(value) as unknown; } catch { return fallback; }
}

let columnsEnsured = false;
/** Call after resetAgentDatabase() to re-run column checks. */
export function resetColumnsFlag(): void { columnsEnsured = false; }
function ensureExtraColumns(): void {
  if (columnsEnsured) return;
  withAgentDatabase((db) => {
    const stepCols = new Set(
      (db.prepare("PRAGMA table_info(task_steps)").all() as Array<{ name: string }>).map((c) => c.name)
    );
    const taskCols = new Set(
      (db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>).map((c) => c.name)
    );
    if (!stepCols.has("error_type")) {
      try { db.prepare("ALTER TABLE task_steps ADD COLUMN error_type TEXT").run(); } catch { /* ignore */ }
    }
    if (!stepCols.has("run_when")) {
      try { db.prepare("ALTER TABLE task_steps ADD COLUMN run_when TEXT DEFAULT 'success'").run(); } catch { /* ignore */ }
    }
    if (!taskCols.has("last_heartbeat")) {
      try { db.prepare("ALTER TABLE tasks ADD COLUMN last_heartbeat TEXT").run(); } catch { /* ignore */ }
    }
    if (!taskCols.has("execution_context")) {
      try { db.prepare("ALTER TABLE tasks ADD COLUMN execution_context TEXT").run(); } catch { /* ignore */ }
    }
    if (!taskCols.has("max_recovery")) {
      try { db.prepare("ALTER TABLE tasks ADD COLUMN max_recovery INTEGER").run(); } catch { /* ignore */ }
    }
    if (!taskCols.has("retry_policy")) {
      try { db.prepare("ALTER TABLE tasks ADD COLUMN retry_policy TEXT").run(); } catch { /* ignore */ }
    }
    if (!taskCols.has("total_run_count")) {
      try { db.prepare("ALTER TABLE tasks ADD COLUMN total_run_count INTEGER DEFAULT 0").run(); } catch { /* ignore */ }
    }
    if (!taskCols.has("idempotency_key")) {
      try { db.prepare("ALTER TABLE tasks ADD COLUMN idempotency_key TEXT").run(); } catch { /* ignore */ }
    }
    // Unique index for idempotency deduplication
    try { db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_idempotency_key ON tasks(idempotency_key) WHERE idempotency_key IS NOT NULL").run(); } catch { /* ignore */ }
    if (!taskCols.has("file_revision")) {
      try { db.prepare("ALTER TABLE file_backups ADD COLUMN file_revision TEXT").run(); } catch { /* ignore */ }
    }
    if (!stepCols.has("attempts")) {
      try { db.prepare("ALTER TABLE task_steps ADD COLUMN attempts INTEGER DEFAULT 0").run(); } catch { /* ignore */ }
    }
    if (!stepCols.has("failed_attempts")) {
      try { db.prepare("ALTER TABLE task_steps ADD COLUMN failed_attempts INTEGER DEFAULT 0").run(); } catch { /* ignore */ }
    }
    if (!stepCols.has("attempt_history")) {
      try { db.prepare("ALTER TABLE task_steps ADD COLUMN attempt_history TEXT").run(); } catch { /* ignore */ }
    }
    if (!stepCols.has("template_arguments")) {
      try { db.prepare("ALTER TABLE task_steps ADD COLUMN template_arguments TEXT").run(); } catch { /* ignore */ }
    }
    if (!stepCols.has("step_timeout_ms")) {
      try { db.prepare("ALTER TABLE task_steps ADD COLUMN step_timeout_ms INTEGER").run(); } catch { /* ignore */ }
    }
    // Projects: add status column if missing
    const projectCols = new Set(
      (db.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>).map((c) => c.name)
    );
    if (!projectCols.has("status")) {
      try { db.prepare("ALTER TABLE projects ADD COLUMN status TEXT DEFAULT 'active'").run(); } catch { /* ignore */ }
    }
  });
  columnsEnsured = true;
}

/**
 * Look up an existing task by its idempotency key.
 * Returns the task ID if found, undefined otherwise.
 */
export function findTaskByIdempotencyKey(key: string): string | undefined {
  ensureExtraColumns();
  return withAgentDatabase((db) => {
    const row = db.prepare("SELECT id FROM tasks WHERE idempotency_key = ?").get(key) as { id: string } | undefined;
    return row?.id;
  });
}

export function saveTaskPlan(plan: TaskPlan, status: TaskState = plan.state ?? "planning", correlationId = plan.correlationId): void {
  plan.state = status;
  ensureExtraColumns();
  const transaction = withAgentDatabase((db) => {
    const now = new Date().toISOString();
    return db.transaction(() => {
      db.prepare(`
        INSERT INTO tasks(id, title, description, status, correlation_id, idempotency_key, execution_context, max_recovery, retry_policy, total_run_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description,
          status=excluded.status, correlation_id=COALESCE(excluded.correlation_id, tasks.correlation_id),
          idempotency_key=COALESCE(excluded.idempotency_key, tasks.idempotency_key),
          execution_context=COALESCE(excluded.execution_context, tasks.execution_context),
          max_recovery=COALESCE(excluded.max_recovery, tasks.max_recovery),
          retry_policy=COALESCE(excluded.retry_policy, tasks.retry_policy),
          total_run_count=excluded.total_run_count, updated_at=excluded.updated_at
      `).run(plan.id, plan.task, plan.description ?? plan.task, status, correlationId ?? null, plan.idempotencyKey ?? null,
        plan.executionContext ? JSON.stringify(plan.executionContext) : null,
        plan.maxRecovery ?? null,
        plan.retryPolicy ? JSON.stringify(plan.retryPolicy) : null,
        plan.totalRunCount ?? 0, now, now);

      const statement = db.prepare(`
        INSERT INTO task_steps(task_id, step_id, step_order, action, tool, input, dependencies, status, output, error, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(task_id, step_id) DO UPDATE SET step_order=excluded.step_order, action=excluded.action,
          tool=excluded.tool, input=excluded.input, dependencies=excluded.dependencies, status=excluded.status,
          output=excluded.output, error=excluded.error, updated_at=excluded.updated_at
      `);
      plan.steps.forEach((step, index) => statement.run(
        plan.id, step.id, index, step.action, step.tool ?? null, JSON.stringify(step.arguments ?? {}),
        JSON.stringify(step.dependsOn ?? []), step.status, step.output === undefined ? null : JSON.stringify(step.output),
        step.error ?? null, now, now
      ));
      // Save run_when, timeout, template provenance, and attempt counters
      const stepUpdateStmt = db.prepare("UPDATE task_steps SET run_when = ?, step_timeout_ms = ?, template_arguments = COALESCE(?, template_arguments), attempts = ?, failed_attempts = ?, attempt_history = ? WHERE task_id = ? AND step_id = ?");
      plan.steps.forEach((step) => stepUpdateStmt.run(
        step.runWhen ?? "success",
        step.timeout ?? null,
        step.templateArguments ? JSON.stringify(step.templateArguments) : null,
        step.attempts ?? 0,
        step.failedAttempts ?? 0,
        step.attemptHistory ? JSON.stringify(step.attemptHistory) : null,
        plan.id, step.id
      ));
    });
  });
  transaction();
}

/**
 * Persist only the task row (status + heartbeat) — for state transitions where
 * no step data changed. saveTaskPlan rewrites the task row AND every step row;
 * calling it on every loop move() caused massive write amplification
 * (~200 full-plan rewrites for a 100-step task).
 */
export function saveTaskStatus(taskId: string, status: TaskState, correlationId?: string): void {
  ensureExtraColumns();
  withAgentDatabase((db) => db.prepare(`
    UPDATE tasks SET status = ?, updated_at = ?, last_heartbeat = ?
    WHERE id = ?
  `).run(status, new Date().toISOString(), new Date().toISOString(), taskId));
  void correlationId;
}

export function saveTaskStep(taskId: string, step: TaskStep, order: number): void {
  ensureExtraColumns();
  withAgentDatabase((db) => db.prepare(`
    UPDATE task_steps SET step_order=?, action=?, tool=?, input=?, dependencies=?, run_when=?, step_timeout_ms=?, status=?, output=?, error=?, error_type=?, attempts=?, failed_attempts=?, attempt_history=?, template_arguments=?, updated_at=?
    WHERE task_id=? AND step_id=?
  `).run(order, step.action, step.tool ?? null, JSON.stringify(step.arguments ?? {}), JSON.stringify(step.dependsOn ?? []),
    step.runWhen ?? "success",
    step.timeout ?? null,
    step.status, step.output === undefined ? null : JSON.stringify(step.output), step.error ?? null,
    step.errorType ?? null,
    step.attempts ?? 0, step.failedAttempts ?? 0,
    step.attemptHistory ? JSON.stringify(step.attemptHistory) : null,
    step.templateArguments ? JSON.stringify(step.templateArguments) : null,
    new Date().toISOString(), taskId, step.id));
}

export function getTaskPlan(taskId: string): TaskPlan | null {
  ensureExtraColumns();
  return withAgentDatabase((db) => {
    const task = db.prepare("SELECT id, title, description, status, correlation_id, execution_context, max_recovery, retry_policy, total_run_count FROM tasks WHERE id=?").get(taskId) as TaskRow & { execution_context: string | null; max_recovery: number | null; retry_policy: string | null; total_run_count: number | null } | undefined;
    if (!task) return null;
    const rows = db.prepare("SELECT * FROM task_steps WHERE task_id=? ORDER BY step_order").all(taskId) as StepRow[];
    
    // Fetch pending approval if task is in waiting_approval state
    let pendingApproval: { approvalId: number; stepId: number; action: string; risk: string; reason: string } | undefined;
    if (task.status === "waiting_approval") {
      const approval = db.prepare(
        "SELECT id, step_id, action, risk, reason FROM approval_requests WHERE task_id = ? AND consumed_at IS NULL ORDER BY id DESC LIMIT 1"
      ).get(taskId) as { id: number; step_id: number; action: string; risk: string; reason: string } | undefined;
      if (approval) {
        pendingApproval = {
          approvalId: approval.id,
          stepId: approval.step_id,
          action: approval.action,
          risk: approval.risk,
          reason: approval.reason,
        };
      }
    }
    
    return {
      id: task.id,
      task: task.title ?? task.description,
      description: task.description,
      correlationId: task.correlation_id ?? undefined,
      state: task.status,
        executionContext: parseJson(task.execution_context ?? null, undefined) as TaskExecutionContext | undefined,
      maxRecovery: task.max_recovery ?? undefined,
      retryPolicy: parseJson(task.retry_policy, undefined) as { maxTotalAttempts?: number; maxConsecutiveFailures?: number } | undefined,
      totalRunCount: task.total_run_count ?? undefined,
      pendingApproval,
      steps: rows.map((row) => {
        const step: TaskStep = {
          id: row.step_id,
          action: row.action,
          arguments: parseJson(row.input, {}) as Record<string, unknown>,
          dependsOn: parseJson(row.dependencies, []) as number[],
          runWhen: (row as any).run_when && (row as any).run_when !== "success" ? (row as any).run_when : undefined,
          status: row.status
        };
        if ((row as any).step_timeout_ms != null) step.timeout = (row as any).step_timeout_ms;
        if (row.tool !== null) step.tool = row.tool;
        if (row.output !== null) step.output = parseJson(row.output, undefined);
        if (row.error !== null) step.error = row.error;
        if (row.error_type !== null) step.errorType = row.error_type;
        const r = row as any;
        if ("attempts" in r && r.attempts != null) step.attempts = r.attempts;
        if ("failed_attempts" in r && r.failed_attempts != null) step.failedAttempts = r.failed_attempts;
        if ("attempt_history" in r && r.attempt_history != null) step.attemptHistory = parseJson(r.attempt_history, undefined) as StepAttempt[];
        if ("template_arguments" in r && r.template_arguments != null) step.templateArguments = parseJson(r.template_arguments, undefined) as Record<string, unknown>;
        return step;
      })
    };
  });
}

export function listTasks(limit = 50): Array<Record<string, unknown>> {
  return withAgentDatabase((db) => db.prepare(`
    SELECT id, title, description, status, correlation_id, created_at, updated_at
    FROM tasks ORDER BY updated_at DESC LIMIT ?
  `).all(limit) as Array<Record<string, unknown>>);
}

export function saveMemoryItem(input: { taskId?: string; projectId?: string; kind: string; content: unknown }): number {
  return withAgentDatabase((db) => Number(db.prepare(`
    INSERT INTO memory_items(project_id, task_id, kind, content, created_at) VALUES (?, ?, ?, ?, ?)
  `).run(input.projectId ?? null, input.taskId ?? null, input.kind, JSON.stringify(input.content), new Date().toISOString()).lastInsertRowid));
}

export function getMemoryItem(id: number): Record<string, unknown> | null {
  return withAgentDatabase((db) => {
    const row = db.prepare("SELECT * FROM memory_items WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return { ...row, content: typeof row.content === "string" ? parseJson(row.content, row.content) : row.content };
  }) ?? null;
}

export function deleteMemoryItem(id: number): boolean {
  return withAgentDatabase((db) => db.prepare("DELETE FROM memory_items WHERE id = ?").run(id).changes > 0);
}

export function listMemoryItems(input: { taskId?: string; projectId?: string; kind?: string; limit?: number; offset?: number }): { items: Array<Record<string, unknown>>; total: number; hasMore: boolean } {
  return withAgentDatabase((db) => {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (input.taskId) { clauses.push("task_id = ?"); values.push(input.taskId); }
    if (input.projectId) { clauses.push("project_id = ?"); values.push(input.projectId); }
    if (input.kind) { clauses.push("kind = ?"); values.push(input.kind); }
    const whereClause = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = input.limit ?? 50;
    const offset = input.offset ?? 0;
    const total = (db.prepare(`SELECT COUNT(*) AS count FROM memory_items ${whereClause}`).get(...values) as { count: number }).count;
    const rows = db.prepare(`SELECT * FROM memory_items ${whereClause} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...values, limit, offset) as Array<Record<string, unknown>>;
    return {
      items: rows.map((row) => ({ ...row, content: typeof row.content === "string" ? parseJson(row.content, row.content) : row.content })),
      total,
      hasMore: offset + limit < total,
    };
  });
}

/**
 * Canonicalize a project path for identity comparisons.
 * Normalizes separators, removes trailing slashes, lowercases on Windows.
 */
export function canonicalizePath(p: string): string {
  let resolved = path.resolve(p);
  resolved = path.normalize(resolved);
  // Remove trailing separator (but not root like D:\)
  if (resolved.length > 1 && (resolved.endsWith("/") || resolved.endsWith("\\"))) {
    resolved = resolved.slice(0, -1);
  }
  return resolved;
}

export function saveProject(input: { id?: string; name: string; path: string; description?: string; lastAction?: string; nextAction?: string }): string {
  ensureExtraColumns();
  return withAgentDatabase((db) => {
    const now = new Date().toISOString();
    const canonical = canonicalizePath(input.path);

    if (input.id) {
      // UPDATE by ID — reject if not found
      const existing = db.prepare("SELECT id, path FROM projects WHERE id = ?").get(input.id) as { id: string; path: string } | undefined;
      if (!existing) throw new Error(`Project not found: ${input.id}`);
      // If path changed, check no other project owns the new canonical path
      const existingCanonical = canonicalizePath(existing.path);
      if (existingCanonical !== canonical) {
        const conflict = db.prepare("SELECT id FROM projects WHERE path = ? AND id != ?").get(canonical, input.id) as { id: string } | undefined;
        if (conflict) throw new Error(`Path already registered to project ${conflict.id}`);
      }
      db.prepare(`
        UPDATE projects SET name=?, path=?, description=?, last_action=?, next_action=?, updated_at=?
        WHERE id=?
      `).run(input.name, input.path, input.description ?? null, input.lastAction ?? null, input.nextAction ?? null, now, input.id);
      return input.id;
    }

    // CREATE — check if canonical path already exists
    const existingByPath = db.prepare("SELECT id FROM projects WHERE path = ?").get(canonical) as { id: string } | undefined;
    if (existingByPath) {
      throw new Error(`Path already registered to project ${existingByPath.id}`);
    }

    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO projects(id, name, path, description, last_action, next_action, created_at, updated_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `).run(id, input.name, input.path, input.description ?? null, input.lastAction ?? null, input.nextAction ?? null, now, now);
    return id;
  });
}

export function getProject(id: string): Record<string, unknown> | null {
  ensureExtraColumns();
  return withAgentDatabase((db) => db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Record<string, unknown> | undefined) ?? null;
}

export function archiveProject(id: string): boolean {
  ensureExtraColumns();
  return withAgentDatabase((db) => db.prepare(
    "UPDATE projects SET status = 'archived', updated_at = ? WHERE id = ?"
  ).run(new Date().toISOString(), id).changes > 0);
}

export function deleteProject(id: string): boolean {
  ensureExtraColumns();
  return withAgentDatabase((db) => db.prepare("DELETE FROM projects WHERE id = ?").run(id).changes > 0);
}

export function listProjects(
  limit = 50,
  offset = 0,
  status?: "active" | "archived"
): { items: Array<Record<string, unknown>>; total: number; hasMore: boolean } {
  ensureExtraColumns();
  return withAgentDatabase((db) => {
    const where = status ? " WHERE status = ?" : "";
    const params = status ? [status] : [];
    const total = (db.prepare(`SELECT COUNT(*) AS count FROM projects${where}`).get(...params) as { count: number }).count;
    const items = db.prepare(`SELECT * FROM projects${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as Array<Record<string, unknown>>;
    return { items, total, hasMore: offset + limit < total };
  });
}

// ─── Heartbeat ──────────────────────────────────────────────────────

export function updateTaskHeartbeat(taskId: string): void {
  ensureExtraColumns();
  withAgentDatabase((db) => db.prepare(
    "UPDATE tasks SET last_heartbeat = ? WHERE id = ?"
  ).run(new Date().toISOString(), taskId));
}

// ─── Crash Recovery ─────────────────────────────────────────────────

const INTERRUPTED_STATES = ["executing", "checkpointing", "recovering", "resuming", "verifying"];

export function findInterruptedTasks(): TaskPlan[] {
  ensureExtraColumns();
    return withAgentDatabase((db) => {
    const rows = db.prepare(
      `SELECT id, title, description, status, correlation_id, execution_context, max_recovery FROM tasks
       WHERE status IN (${INTERRUPTED_STATES.map(() => "?").join(",")})`
    ).all(...INTERRUPTED_STATES) as TaskRow[];

    return rows.map((task) => {
      const stepRows = db.prepare(
        "SELECT * FROM task_steps WHERE task_id=? ORDER BY step_order"
      ).all(task.id) as StepRow[];
      return {
        id: task.id,
        task: task.title ?? task.description,
        description: task.description,
        correlationId: task.correlation_id ?? undefined,
        state: task.status,
        executionContext: parseJson(task.execution_context ?? null, undefined) as TaskExecutionContext | undefined,
        steps: stepRows.map((row) => {
          const step: TaskStep = {
            id: row.step_id,
            action: row.action,
            arguments: parseJson(row.input, {}) as Record<string, unknown>,
            dependsOn: parseJson(row.dependencies, []) as number[],
            status: row.status
          };
          if ((row as any).step_timeout_ms != null) step.timeout = (row as any).step_timeout_ms;
          if (row.tool !== null) step.tool = row.tool as TaskStep["tool"];
          if (row.output !== null) step.output = parseJson(row.output, undefined);
          if (row.error !== null) step.error = row.error;
          if (row.error_type !== null) step.errorType = row.error_type;
          return step;
        })
      };
    });
  });
}

export function markTaskRecovered(taskId: string): void {
  withAgentDatabase((db) => db.prepare(
    "UPDATE tasks SET status = 'resuming', last_heartbeat = ? WHERE id = ?"
  ).run(new Date().toISOString(), taskId));
}
