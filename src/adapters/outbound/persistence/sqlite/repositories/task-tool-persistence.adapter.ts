import { withAgentDatabase } from "../../../../../core/memory/database.js";

/**
 * Legacy Task MCP SQL operations, isolated behind the SQLite outbound adapter.
 * Keep the database transaction boundary in this adapter. The Task use-case
 * transition/terminal-append policy is deliberately NOT changed by this move;
 * that security correction belongs to R3.
 */
export interface PersistedStepAppend {
  readonly id: number;
  readonly action: string;
  readonly tool?: string | null;
  readonly arguments?: Record<string, unknown>;
  readonly dependsOn?: readonly number[];
  readonly status: "pending";
  readonly runWhen?: "success" | "failure" | "always";
  readonly timeout?: number;
}
export interface TaskLinkRow {
  readonly relation: string;
  readonly created_at: string;
}
export type TaskLinkUpstream = TaskLinkRow & { readonly source_task_id: string };
export type TaskLinkDownstream = TaskLinkRow & { readonly target_task_id: string };

export function persistAppendedTaskSteps(taskId: string, previousStepCount: number, steps: readonly PersistedStepAppend[]): void {
  withAgentDatabase((db) => {
    const stmt = db.prepare(`INSERT INTO task_steps
      (task_id, step_id, step_order, action, tool, input, dependencies, status, run_when, step_timeout_ms, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const now = new Date().toISOString();
    for (const [index, step] of steps.entries()) {
      stmt.run(taskId, step.id, previousStepCount + index, step.action, step.tool ?? null,
        JSON.stringify(step.arguments ?? {}), JSON.stringify(step.dependsOn ?? []),
        step.status, step.runWhen ?? "success", step.timeout ?? null, now, now);
    }
  });
}

export function persistTaskLink(sourceTaskId: string, targetTaskId: string, relation: string): void {
  withAgentDatabase((db) => db.prepare(
    "INSERT INTO task_links(source_task_id, target_task_id, relation, created_at) VALUES (?, ?, ?, ?)"
  ).run(sourceTaskId, targetTaskId, relation, new Date().toISOString()));
}

export function getPersistedTaskLinks(taskId: string): {
  readonly upstream: readonly TaskLinkUpstream[];
  readonly downstream: readonly TaskLinkDownstream[];
} {
  return withAgentDatabase((db) => ({
    upstream: db.prepare(
      "SELECT source_task_id, relation, created_at FROM task_links WHERE target_task_id = ?"
    ).all(taskId) as TaskLinkUpstream[],
    downstream: db.prepare(
      "SELECT target_task_id, relation, created_at FROM task_links WHERE source_task_id = ?"
    ).all(taskId) as TaskLinkDownstream[],
  }));
}
