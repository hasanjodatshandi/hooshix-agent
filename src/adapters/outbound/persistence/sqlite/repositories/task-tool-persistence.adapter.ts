import { withAgentDatabase } from "../../../../../core/memory/database/index.js";
import {assertTaskLeaseWrite} from "./task-lease.adapter.js";

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

/** R3.09: completed/cancelled Tasks are terminal. A failed Task may receive
 * corrective steps only after every uncertain or still-running effect is
 * resolved; append+revision/state transition are a single SQLite transaction. */
export function persistAppendedTaskSteps(
  taskId:string,previousStepCount:number,steps:readonly PersistedStepAppend[],expectedRevision:number,
):number {
  return withAgentDatabase(db=>db.transaction(()=>{
    assertTaskLeaseWrite(db,taskId);
    const task=db.prepare("SELECT status,task_revision FROM tasks WHERE id=?")
      .get(taskId) as {status:string;task_revision:number}|undefined;
    if(!task)throw new Error("task_not_found");
    if(task.status==="completed"||task.status==="cancelled")
      throw new Error("terminal_task_append_forbidden");
    if(task.status!=="failed")throw new Error("task_append_requires_failed_state");
    if(task.task_revision!==expectedRevision)throw new Error("task_append_revision_conflict");
    const existing=db.prepare("SELECT COUNT(*) AS count,MAX(step_id) AS maxId FROM task_steps WHERE task_id=?")
      .get(taskId) as {count:number;maxId:number|null};
    if(existing.count!==previousStepCount||steps.some((step,index)=>
      step.id!==(existing.maxId??0)+index+1))
      throw new Error("task_append_stale_snapshot");
    const unresolved=(db.prepare("SELECT COUNT(*) AS n FROM task_steps WHERE task_id=? AND status IN ('outcome_unknown','running','pending_approval')")
      .get(taskId) as {n:number}).n;
    if(unresolved!==0)throw new Error("task_append_requires_reconciliation");
    const stmt=db.prepare("INSERT INTO task_steps (task_id,step_id,step_order,action,tool,input,dependencies,status,run_when,step_timeout_ms,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
    const now=new Date().toISOString();
    for(const [index,step] of steps.entries()){
      stmt.run(taskId,step.id,previousStepCount+index,step.action,step.tool??null,
        JSON.stringify(step.arguments??{}),JSON.stringify(step.dependsOn??[]),
        step.status,step.runWhen??"success",step.timeout??null,now,now);
    }
    const changed=db.prepare("UPDATE tasks SET status='planning',task_revision=task_revision+1,total_run_count=0,updated_at=? WHERE id=? AND status='failed' AND task_revision=?")
      .run(now,taskId,expectedRevision);
    if(changed.changes!==1)throw new Error("task_append_revision_conflict");
    return expectedRevision+1;
  })());
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