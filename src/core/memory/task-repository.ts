import type { TaskPlan, TaskStep, TaskStepStatus } from "../planner/task-planner.js";
import type { TaskState } from "../state/task-state-machine.js";
import { withAgentDatabase } from "./database.js";

interface TaskRow {
  id: string;
  title: string | null;
  description: string;
  correlation_id: string | null;
  status: TaskState;
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
}

function parseJson(value: string | null, fallback: unknown): unknown {
  if (value === null) return fallback;
  try { return JSON.parse(value) as unknown; } catch { return fallback; }
}

export function saveTaskPlan(plan: TaskPlan, status: TaskState = plan.state ?? "planning", correlationId = plan.correlationId): void {
  plan.state = status;
  withAgentDatabase((db) => {
    const now = new Date().toISOString();
    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO tasks(id, title, description, status, correlation_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description,
          status=excluded.status, correlation_id=COALESCE(excluded.correlation_id, tasks.correlation_id), updated_at=excluded.updated_at
      `).run(plan.id, plan.task, plan.description ?? plan.task, status, correlationId ?? null, now, now);

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
    });
    transaction();
  });
}

export function saveTaskStep(taskId: string, step: TaskStep, order: number): void {
  withAgentDatabase((db) => db.prepare(`
    UPDATE task_steps SET step_order=?, action=?, tool=?, input=?, dependencies=?, status=?, output=?, error=?, updated_at=?
    WHERE task_id=? AND step_id=?
  `).run(order, step.action, step.tool ?? null, JSON.stringify(step.arguments ?? {}), JSON.stringify(step.dependsOn ?? []),
    step.status, step.output === undefined ? null : JSON.stringify(step.output), step.error ?? null,
    new Date().toISOString(), taskId, step.id));
}

export function getTaskPlan(taskId: string): TaskPlan | null {
  return withAgentDatabase((db) => {
    const task = db.prepare("SELECT id, title, description, status, correlation_id FROM tasks WHERE id=?").get(taskId) as TaskRow | undefined;
    if (!task) return null;
    const rows = db.prepare("SELECT * FROM task_steps WHERE task_id=? ORDER BY step_order").all(taskId) as StepRow[];
    return {
      id: task.id,
      task: task.title ?? task.description,
      description: task.description,
      correlationId: task.correlation_id ?? undefined,
      state: task.status,
      steps: rows.map((row) => {
        const step: TaskStep = {
          id: row.step_id,
          action: row.action,
          arguments: parseJson(row.input, {}) as Record<string, unknown>,
          dependsOn: parseJson(row.dependencies, []) as number[],
          status: row.status
        };
        if (row.tool !== null) step.tool = row.tool;
        if (row.output !== null) step.output = parseJson(row.output, undefined);
        if (row.error !== null) step.error = row.error;
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

export function listMemoryItems(input: { taskId?: string; projectId?: string; limit?: number }): Array<Record<string, unknown>> {
  return withAgentDatabase((db) => {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (input.taskId) { clauses.push("task_id = ?"); values.push(input.taskId); }
    if (input.projectId) { clauses.push("project_id = ?"); values.push(input.projectId); }
    values.push(input.limit ?? 50);
    const rows = db.prepare(`SELECT * FROM memory_items ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`).all(...values) as Array<Record<string, unknown>>;
    return rows.map((row) => ({ ...row, content: typeof row.content === "string" ? parseJson(row.content, row.content) : row.content }));
  });
}

export function saveProject(input: { id?: string; name: string; path: string; description?: string; lastAction?: string; nextAction?: string }): string {
  return withAgentDatabase((db) => {
    const id = input.id ?? crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO projects(id, name, path, description, last_action, next_action, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET name=excluded.name, description=excluded.description,
        last_action=excluded.last_action, next_action=excluded.next_action, updated_at=excluded.updated_at
    `).run(id, input.name, input.path, input.description ?? null, input.lastAction ?? null, input.nextAction ?? null, now, now);
    const row = db.prepare("SELECT id FROM projects WHERE path=?").get(input.path) as { id: string };
    return row.id;
  });
}

export function listProjects(limit = 50): Array<Record<string, unknown>> {
  return withAgentDatabase((db) => db.prepare("SELECT * FROM projects ORDER BY updated_at DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>);
}
