import type { TaskPlan, TaskStep, TaskStepStatus, TaskExecutionContext, StepAttempt } from "../../../../../application/dto/legacy-task-plan.js";
import type { TaskState } from "../../../../../core/state/task-state-machine.js";
import { withAgentDatabase } from "../../../../../core/memory/database/index.js";
import { canonicalProjectPath } from "../../../../../infrastructure/project-path-identity.js";
import type Database from "better-sqlite3";
import {assertTaskLeaseWrite} from "./task-lease.adapter.js";
import type { ExecutionReceipt } from "../../../../../domain/task/execution-outcome.js";

interface TaskRow {
  id: string;
  title: string | null;
  description: string;
  correlation_id: string | null;
  status: TaskState;
  execution_context?: string | null;
  max_recovery?: number | null;
  idempotency_key: string | null;
  request_hash: string | null;
  retry_policy: string | null;
  total_run_count: number | null;
  task_revision: number | null;
  created_at: string;
  updated_at: string;
  project_id?: string | null;
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
  run_when?: TaskStep["runWhen"] | null;
  step_timeout_ms?: number | null;
  attempts?: number | null;
  failed_attempts?: number | null;
  attempt_history?: string | null;
  template_arguments?: string | null;
}

function parseJson(value: string | null, fallback: unknown): unknown {
  if (value === null) return fallback;
  try { return JSON.parse(value) as unknown; } catch { return fallback; }
}

/** Canonical DB-row → TaskStep mapper used by normal reads and crash recovery. */
function hydrateTaskStep(row: StepRow): TaskStep {
  const step: TaskStep = {
    id: row.step_id,
    action: row.action,
    arguments: parseJson(row.input, {}) as Record<string, unknown>,
    dependsOn: parseJson(row.dependencies, []) as number[],
    runWhen: row.run_when ?? undefined,
    status: row.status,
  };
  if (row.step_timeout_ms != null) step.timeout = row.step_timeout_ms;
  if (row.tool !== null) step.tool = row.tool;
  if (row.output !== null) step.output = parseJson(row.output, undefined);
  if (row.error !== null) step.error = row.error;
  if (row.error_type !== null) step.errorType = row.error_type;
  if (row.attempts != null) step.attempts = row.attempts;
  if (row.failed_attempts != null) step.failedAttempts = row.failed_attempts;
  if (row.attempt_history != null) step.attemptHistory = parseJson(row.attempt_history, undefined) as StepAttempt[];
  if (row.template_arguments != null) step.templateArguments = parseJson(row.template_arguments, undefined) as Record<string, unknown>;
  return step;
}

/**
 * Backward-compatible test hook. Schema evolution is owned exclusively by
 * versioned database migrations; repository calls never mutate schema.
 */
export function resetColumnsFlag(): void { /* no-op */ }
function ensureExtraColumns(): void { /* migrations are authoritative */ }

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
      assertTaskLeaseWrite(db,plan.id);
      db.prepare(`
        INSERT INTO tasks(id, title, description, status, correlation_id, idempotency_key, request_hash, execution_context, max_recovery, retry_policy, total_run_count, task_revision, principal_id, project_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description,
          status=excluded.status, correlation_id=COALESCE(excluded.correlation_id, tasks.correlation_id),
          idempotency_key=COALESCE(excluded.idempotency_key, tasks.idempotency_key),
          request_hash=COALESCE(tasks.request_hash, excluded.request_hash),
          execution_context=COALESCE(excluded.execution_context, tasks.execution_context),
          max_recovery=COALESCE(excluded.max_recovery, tasks.max_recovery),
          retry_policy=COALESCE(excluded.retry_policy, tasks.retry_policy),
          total_run_count=excluded.total_run_count, task_revision=excluded.task_revision,
          project_id=COALESCE(excluded.project_id, tasks.project_id),
          updated_at=excluded.updated_at
       `).run(plan.id, plan.task, plan.description ?? plan.task, status, correlationId ?? null, plan.idempotencyKey ?? null, plan.requestHash ?? null,
        plan.executionContext ? JSON.stringify(plan.executionContext) : null,
        plan.maxRecovery ?? null,
        plan.retryPolicy ? JSON.stringify(plan.retryPolicy) : null,
        plan.totalRunCount ?? 0, plan.revision ?? 0,
        // Ownership is set at creation and never re-assigned: a task's audit
        // trail belongs to the client that created it.
        plan.executionContext?.principalId ?? "local-stdio",
        // The project binding is likewise set at creation; a later save of the
        // same plan cannot rebind a task to a different project.
        plan.projectId ?? null,
        plan.createdAt ?? now, now);

      const statement = db.prepare(`
        INSERT INTO task_steps(task_id, step_id, step_order, action, tool, input, dependencies, status, output, error, error_type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(task_id, step_id) DO UPDATE SET step_order=excluded.step_order, action=excluded.action,
          tool=excluded.tool, input=excluded.input, dependencies=excluded.dependencies, status=excluded.status,
          output=excluded.output, error=excluded.error, error_type=excluded.error_type, updated_at=excluded.updated_at
      `);
      plan.steps.forEach((step, index) => statement.run(
        plan.id, step.id, index, step.action, step.tool ?? null, JSON.stringify(step.arguments ?? {}),
        JSON.stringify(step.dependsOn ?? []), step.status, step.output === undefined ? null : JSON.stringify(step.output),
        step.error ?? null, step.errorType ?? null, now, now
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
  withAgentDatabase(db=>db.transaction(()=>{
    assertTaskLeaseWrite(db,taskId);
    return db.prepare(`
      UPDATE tasks SET status = ?, updated_at = ?, last_heartbeat = ?
      WHERE id = ?
    `).run(status,new Date().toISOString(),new Date().toISOString(),taskId);
  })());
  void correlationId;
}

/** Writes the mutable Step state. Receipt START is inserted in the same transaction before dispatch. */
function writeStepRow(db:Database.Database,taskId:string,step:TaskStep,order:number):number {
  return db.prepare(`
    UPDATE task_steps SET step_order=?, action=?, tool=?, input=?, dependencies=?, run_when=?, step_timeout_ms=?, status=?, output=?, error=?, error_type=?, attempts=?, failed_attempts=?, attempt_history=?, template_arguments=?, updated_at=?
    WHERE task_id=? AND step_id=?
  `).run(order,step.action,step.tool??null,JSON.stringify(step.arguments??{}),JSON.stringify(step.dependsOn??[]),
    step.runWhen??"success",step.timeout??null,step.status,
    step.output===undefined?null:JSON.stringify(step.output),step.error??null,step.errorType??null,
    step.attempts??0,step.failedAttempts??0,
    step.attemptHistory?JSON.stringify(step.attemptHistory):null,
    step.templateArguments?JSON.stringify(step.templateArguments):null,
    new Date().toISOString(),taskId,step.id).changes;
}

export function saveTaskStep(taskId:string,step:TaskStep,order:number):void {
  ensureExtraColumns();
  withAgentDatabase(db=>db.transaction(()=>{
    assertTaskLeaseWrite(db,taskId);
    writeStepRow(db,taskId,step,order);
  })());
}

/**
 * Durable mutation intent: the Step's running state and unique receipt start
 * commit atomically before invoking the tool. No arguments/output/secret content
 * is written to receipt history. A crash can leave a STARTED receipt; that is
 * NOT proof of completion and is reconciled in the later R3.04-R3.06 leaf.
 */
export function beginStepExecutionReceipt(
  taskId:string,step:TaskStep,order:number,receipt:ExecutionReceipt,
):void {
  if(step.status!=="running"||step.attempts===undefined||step.attempts<1||
    receipt.status!=="started"||receipt.finishedAt!==undefined||
    !receipt.executionId||receipt.stepId!==step.id||
    (step.tool!==undefined&&receipt.toolId!==step.tool)||receipt.effect==="read_only"||
    receipt.reconciliation!=="unresolved")
    throw new Error("invalid_execution_receipt_start");
  withAgentDatabase(db=>db.transaction(()=>{
    assertTaskLeaseWrite(db,taskId);
    if(writeStepRow(db,taskId,step,order)!==1)throw new Error("receipt_task_step_not_found");
    db.prepare(`
      INSERT INTO execution_receipts(
        execution_id,task_id,step_id,attempt,tool_id,effect,status,
        started_at,finished_at,reconciliation,termination,receipt_json
      ) VALUES(?,?,?,?,?,?,?, ?,NULL,?,NULL,?)
    `).run(receipt.executionId,taskId,step.id,step.attempts,receipt.toolId,receipt.effect,
      "started",receipt.startedAt,receipt.reconciliation,JSON.stringify(receipt));
  })());
}

/**
 * Finalize only an existing STARTED receipt; never overwrite immutable
 * execution identity, step/tool/effect, startedAt or an already-final state.
 */
export function finishStepExecutionReceipt(taskId:string,receipt:ExecutionReceipt):void {
  if(receipt.status==="started"||!receipt.finishedAt||
    !receipt.termination||receipt.status==="outcome_unknown"&&
    (receipt.termination!=="unknown"||receipt.reconciliation!=="unresolved")||
    receipt.status!=="outcome_unknown"&&receipt.reconciliation!=="not_required")
    throw new Error("invalid_execution_receipt_finish");
  withAgentDatabase(db=>db.transaction(()=>{
    assertTaskLeaseWrite(db,taskId);
    const row=db.prepare(`SELECT task_id,step_id,tool_id,effect,status,started_at,receipt_json
      FROM execution_receipts WHERE execution_id=?`).get(receipt.executionId) as {
        task_id:string;step_id:number;tool_id:string;effect:string;
        status:string;started_at:string;receipt_json:string;
      }|undefined;
    if(!row||row.task_id!==taskId||row.step_id!==receipt.stepId||
      row.tool_id!==receipt.toolId||row.effect!==receipt.effect||
      row.status!=="started"||row.started_at!==receipt.startedAt)
      throw new Error("execution_receipt_not_started_or_identity_mismatch");
    const original=JSON.parse(row.receipt_json) as ExecutionReceipt;
    if(original.effectId!==receipt.effectId||
      original.idempotencyKeyHash!==receipt.idempotencyKeyHash||
      original.preconditionRevision!==receipt.preconditionRevision||
      original.externalReference!==receipt.externalReference&&original.externalReference!==undefined)
      throw new Error("execution_receipt_identity_modified");
    const result=db.prepare(`
      UPDATE execution_receipts SET status=?,finished_at=?,termination=?,
      reconciliation=?,receipt_json=? WHERE execution_id=? AND status='started'
    `).run(receipt.status,receipt.finishedAt,receipt.termination,
      receipt.reconciliation,JSON.stringify(receipt),receipt.executionId);
    if(result.changes!==1)throw new Error("execution_receipt_already_finalized");
  })());
}

/** Stable ascending attempt history for reconciliation/reporting. */
export function listStepExecutionReceipts(taskId:string,stepId:number):ExecutionReceipt[] {
  return withAgentDatabase(db=>(db.prepare(`
    SELECT receipt_json FROM execution_receipts WHERE task_id=? AND step_id=?
    ORDER BY rowid ASC
  `).all(taskId,stepId) as Array<{receipt_json:string}>)
    .map(row=>JSON.parse(row.receipt_json) as ExecutionReceipt));
}

/**
 * The one DB-row -> TaskPlan aggregate mapper. All normal reads, Task reports,
 * startup resume and interrupted-task discovery invoke this function. The
 * active approval pointer is a derived view, never independently fabricated.
 */
function hydrateTaskById(db:Database.Database,taskId:string):TaskPlan|null {
  const task=db.prepare(`
    SELECT id,title,description,status,correlation_id,idempotency_key,request_hash,
      execution_context,max_recovery,retry_policy,total_run_count,
      task_revision,project_id,created_at,updated_at
    FROM tasks WHERE id=?
  `).get(taskId) as TaskRow|undefined;
  if(!task)return null;
  const stepRows=db.prepare("SELECT * FROM task_steps WHERE task_id=? ORDER BY step_order")
    .all(taskId) as StepRow[];
  const latestReceiptByStep=new Map<number,ExecutionReceipt>();
  const receiptRows=db.prepare(`
    SELECT step_id,receipt_json FROM execution_receipts WHERE task_id=? ORDER BY rowid ASC
  `).all(taskId) as Array<{step_id:number;receipt_json:string}>;
  for(const row of receiptRows)
    latestReceiptByStep.set(row.step_id,JSON.parse(row.receipt_json) as ExecutionReceipt);
  let pendingApproval:TaskPlan["pendingApproval"];
  if(task.status==="waiting_approval") {
    const approval=db.prepare(`
      SELECT id,step_id,action,risk,reason FROM approval_requests
      WHERE task_id=? AND status IN ('pending','approved')
        AND dispatched_at IS NULL
      ORDER BY id DESC LIMIT 1
    `).get(taskId) as {
      id:number;step_id:number;action:string|null;risk:string;reason:string;
    }|undefined;
    if(approval)pendingApproval={
      approvalId:approval.id,stepId:approval.step_id,
      action:approval.action??"",risk:approval.risk,reason:approval.reason,
    };
  }
  return {
    id:task.id,
    task:task.title??task.description,
    description:task.description,
    correlationId:task.correlation_id??undefined,
    idempotencyKey:task.idempotency_key??undefined,
    requestHash:task.request_hash??undefined,
    state:task.status,
    executionContext:parseJson(task.execution_context??null,undefined) as TaskExecutionContext|undefined,
    maxRecovery:task.max_recovery??undefined,
    retryPolicy:parseJson(task.retry_policy??null,undefined) as TaskPlan["retryPolicy"],
    totalRunCount:task.total_run_count??undefined,
    revision:task.task_revision??0,
    projectId:task.project_id??undefined,
    createdAt:task.created_at,
    updatedAt:task.updated_at,
    pendingApproval,
    steps:stepRows.map(row=>{
      const step=hydrateTaskStep(row);
      const receipt=latestReceiptByStep.get(step.id);
      if(receipt)step.lastReceipt=receipt;
      return step;
    }),
  };
}

/** Canonical persisted aggregate entrypoint for direct reads and Task reports. */
export function getTaskPlan(taskId:string):TaskPlan|null {
  ensureExtraColumns();
  return withAgentDatabase(db=>hydrateTaskById(db,taskId));
}

export function listTasks(limit = 50, projectId?: string): Array<Record<string, unknown>> {
  return withAgentDatabase((db) => {
    const sql = projectId
      ? `SELECT id, title, description, status, correlation_id, project_id, created_at, updated_at
         FROM tasks WHERE project_id = ? ORDER BY updated_at DESC LIMIT ?`
      : `SELECT id, title, description, status, correlation_id, project_id, created_at, updated_at
         FROM tasks ORDER BY updated_at DESC LIMIT ?`;
    const stmt = projectId ? db.prepare(sql) : db.prepare(sql);
    const rows = (projectId ? stmt.all(projectId, limit) : stmt.all(limit)) as Array<Record<string, unknown>>;
    return rows;
  });
}

/**
 * R3.05: evidence-based reconciliation changes only the interrupted STEP state,
 * never fabricates the original tool's return value. Every decision and receipt
 * update is in the same transaction. Resolved success remains distinguishable
 * from normal completed execution.
 */
export function applyTaskReconciliationDecision(input:{
  taskId:string;stepId:number;
  decision:"confirmed_succeeded"|"confirmed_failed"|"safe_to_retry";
  evidence:string;verificationTaskId:string;
}):void {
  withAgentDatabase(db=>db.transaction(()=>{
    assertTaskLeaseWrite(db,input.taskId);
    const task=db.prepare("SELECT status FROM tasks WHERE id=?").get(input.taskId) as {status:string}|undefined;
    const step=db.prepare("SELECT status,tool,input FROM task_steps WHERE task_id=? AND step_id=?")
      .get(input.taskId,input.stepId) as {status:string;tool:string|null;input:string}|undefined;
    if(task?.status!=="failed"||step?.status!=="outcome_unknown")
      throw new Error("reconciliation_requires_failed_task_with_unknown_step");
    const newStatus=input.decision==="confirmed_succeeded"?"reconciled_succeeded":
      input.decision==="confirmed_failed"?"reconciled_failed":"pending";
    let nextTaskState=input.decision==="confirmed_failed"?"failed":"planning";
    const receiptRow=db.prepare(`SELECT execution_id,receipt_json FROM execution_receipts
      WHERE task_id=? AND step_id=? ORDER BY rowid DESC LIMIT 1`)
      .get(input.taskId,input.stepId) as {execution_id:string;receipt_json:string}|undefined;
    if(input.decision==="safe_to_retry"&&
      (!receiptRow||step.tool!=="create_file"||
       !(JSON.parse(receiptRow.receipt_json) as ExecutionReceipt).idempotencyKeyHash))
      throw new Error("safe_to_retry_requires_verified_durable_tool_idempotency");
    const stepUpdate=db.prepare(`UPDATE task_steps SET status=?,error=?,updated_at=?
      WHERE task_id=? AND step_id=? AND status='outcome_unknown'`)
      .run(newStatus,
        input.decision==="safe_to_retry"?null:
        input.decision==="confirmed_succeeded"?"Effect observed independently; original tool result remains unknown":
        "No effect reported by independent verification; original tool result remains unknown",
        new Date().toISOString(),input.taskId,input.stepId);
    if(stepUpdate.changes!==1)throw new Error("reconciliation_conflict");
    if(input.decision==="confirmed_succeeded"){
      const pending=(db.prepare(`SELECT COUNT(*) AS count FROM task_steps
        WHERE task_id=? AND status NOT IN ('completed','reconciled_succeeded','cancelled')`)
        .get(input.taskId) as {count:number}).count;
      if(pending===0)nextTaskState="completed";
    }
    const taskUpdate=db.prepare(`UPDATE tasks SET status=?,updated_at=? WHERE id=? AND status='failed'`)
      .run(nextTaskState,new Date().toISOString(),input.taskId);
    if(taskUpdate.changes!==1)throw new Error("reconciliation_conflict");
    if(receiptRow){
      const receipt=JSON.parse(receiptRow.receipt_json) as ExecutionReceipt;
      // Observed external state is NOT retroactive proof that the tool call
      // returned normally, so receipt.status remains outcome_unknown.
      if(receipt.status==="outcome_unknown"&&receipt.reconciliation==="unresolved"){
        const decisionState=input.decision==="confirmed_succeeded"?"effect_observed":
          input.decision==="confirmed_failed"?"effect_not_observed":"effect_not_observed";
        db.prepare("UPDATE execution_receipts SET reconciliation=?,receipt_json=? WHERE execution_id=?")
          .run(decisionState,JSON.stringify({...receipt,reconciliation:decisionState}),receiptRow.execution_id);
      }
    }
    db.prepare(`INSERT INTO memory_items(project_id,task_id,kind,content,created_at)
      VALUES(NULL,?,'outcome_reconciliation',?,?)`).run(input.taskId,JSON.stringify({
        ...input,recordedAt:new Date().toISOString(),originalToolResult:"unknown",replayed:false,
      }),new Date().toISOString());
  })());
}

export function saveMemoryItem(input: { taskId?: string; projectId?: string; kind: string; content: unknown; principalId?: string }): number {
  return withAgentDatabase((db) => Number(db.prepare(`
    INSERT INTO memory_items(project_id, task_id, kind, content, created_at, principal_id) VALUES (?, ?, ?, ?, ?, ?)
  `).run(input.projectId ?? null, input.taskId ?? null, input.kind, JSON.stringify(input.content), new Date().toISOString(), input.principalId ?? "local-stdio").lastInsertRowid));
}

export function getMemoryItem(id: number, principalId?: string): Record<string, unknown> | null {
  return withAgentDatabase((db) => {
    const row = db.prepare(principalScopedMemory("SELECT * FROM memory_items WHERE id = ?", principalId)).get(id, ...(principalId ? [principalId] : [])) as Record<string, unknown> | undefined;
    if (!row) return null;
    return { ...row, content: typeof row.content === "string" ? parseJson(row.content, row.content) : row.content };
  }) ?? null;
}

export function deleteMemoryItem(id: number, principalId?: string): boolean {
  return withAgentDatabase((db) => db.prepare(principalScopedMemory("DELETE FROM memory_items WHERE id = ?", principalId)).run(id, ...(principalId ? [principalId] : [])).changes > 0);
}

/**
 * In-place update of a memory record's kind and/or content. The record is
 * loaded first so an unknown id or a principal mismatch reports nothing-changed
 * rather than mutating another owner's row. updated_at records that the row is
 * no longer the append-only history it was created as.
 */
export function updateMemoryItem(input: { id: number; kind?: string; content?: unknown; principalId?: string }): { id: number; updated: boolean } {
  return withAgentDatabase((db) => {
    const existing = db.prepare(principalScopedMemory("SELECT id FROM memory_items WHERE id = ?", input.principalId)).get(input.id, ...(input.principalId ? [input.principalId] : [])) as { id: number } | undefined;
    if (!existing) return { id: input.id, updated: false };
    const now = new Date().toISOString();
    const sets: string[] = ["updated_at = ?"];
    const values: unknown[] = [now];
    if (input.kind !== undefined) { sets.push("kind = ?"); values.push(input.kind); }
    if (input.content !== undefined) { sets.push("content = ?"); values.push(JSON.stringify(input.content)); }
    db.prepare(`UPDATE memory_items SET ${sets.join(", ")} WHERE id = ?`).run(...values, input.id);
    return { id: input.id, updated: true };
  });
}

/**
 * Scope a memory_items statement to its owner. A missing principalId keeps the
 * legacy unfiltered shape (the local stdio operator and internal callers), so
 * the endpoint never widens to another principal's rows by accident.
 */
function principalScopedMemory(sql: string, principalId?: string): string {
  return principalId ? `${sql} AND principal_id = ?` : sql;
}

export function listMemoryItems(input: { taskId?: string; projectId?: string; kind?: string; limit?: number; offset?: number; principalId?: string }): { items: Array<Record<string, unknown>>; total: number; hasMore: boolean } {
  return withAgentDatabase((db) => {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (input.taskId) { clauses.push("task_id = ?"); values.push(input.taskId); }
    if (input.projectId) { clauses.push("project_id = ?"); values.push(input.projectId); }
    if (input.kind) { clauses.push("kind = ?"); values.push(input.kind); }
    if (input.principalId) { clauses.push("principal_id = ?"); values.push(input.principalId); }
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
export function canonicalizePath(p: string): string { return canonicalProjectPath(p); }
export function saveProject(input: { id?: string; name: string; path: string; description?: string; lastAction?: string; nextAction?: string; principalId?: string }): string {
  ensureExtraColumns();
  const owner = input.principalId ?? "local-stdio";
  return withAgentDatabase((db) => {
    const now = new Date().toISOString();
    const canonical = canonicalizePath(input.path);
    // Case-insensitive name check on Windows
    const nameKey = process.platform === "win32" ? input.name.toLowerCase() : input.name;

    if (input.id) {
      // UPDATE by ID — reject if not found or owned by another principal
      const existing = db.prepare("SELECT id, path, canonical_path, name, principal_id FROM projects WHERE id = ?").get(input.id) as { id: string; path: string; canonical_path: string; name: string; principal_id: string } | undefined;
      if (!existing) throw new Error(`Project not found: ${input.id}`);
      if (existing.principal_id !== owner) throw new Error(`PROJECT_NOT_OWNED: project ${input.id} belongs to another principal`);
      // If path changed, check no other project owns the new canonical path
      const existingCanonical = existing.canonical_path;
      if (existingCanonical !== canonical) {
        const conflict = db.prepare("SELECT id FROM projects WHERE canonical_path = ? AND id != ?").get(canonical, input.id) as { id: string } | undefined;
        if (conflict) throw new Error(`Path already registered to project ${conflict.id}`);
      }
      // If name changed (case-insensitive on Windows), check for duplicate name
      const existingNameKey = process.platform === "win32" ? existing.name.toLowerCase() : existing.name;
      if (nameKey !== existingNameKey) {
        const nameConflict = db.prepare("SELECT id FROM projects WHERE " + (process.platform === "win32" ? "LOWER(name) = ?" : "name = ?") + " AND id != ?").get(nameKey, input.id) as { id: string } | undefined;
        if (nameConflict) throw new Error(`Project name already registered to project ${nameConflict.id}`);
      }
      db.prepare(`
        UPDATE projects SET name=?, path=?, canonical_path=?, display_path=?, description=?, last_action=?, next_action=?, updated_at=?
        WHERE id=?
      `).run(input.name, canonical, canonical, input.path, input.description ?? null, input.lastAction ?? null, input.nextAction ?? null, now, input.id);
      return input.id;
    }

    // CREATE — check if canonical path already exists
    const existingByPath = db.prepare("SELECT id FROM projects WHERE canonical_path = ?").get(canonical) as { id: string } | undefined;
    if (existingByPath) {
      throw new Error(`Path already registered to project ${existingByPath.id}`);
    }
    // Check for duplicate name (case-insensitive on Windows)
    const nameConflict = db.prepare("SELECT id FROM projects WHERE " + (process.platform === "win32" ? "LOWER(name) = ?" : "name = ?")).get(nameKey) as { id: string } | undefined;
    if (nameConflict) throw new Error(`Project name already registered to project ${nameConflict.id}`);

    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO projects(id, name, path, canonical_path, display_path, description, last_action, next_action, created_at, updated_at, status, principal_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `).run(id, input.name, canonical, canonical, input.path, input.description ?? null, input.lastAction ?? null, input.nextAction ?? null, now, now, owner);
    return id;
  });
}

export function getProject(id: string, principalId?: string): Record<string, unknown> | null {
  ensureExtraColumns();
  return withAgentDatabase((db) => db.prepare(principalScopedProject("SELECT * FROM projects WHERE id = ?", principalId)).get(id, ...(principalId ? [principalId] : [])) as Record<string, unknown> | undefined) ?? null;
}

export function archiveProject(id: string, principalId?: string): boolean {
  ensureExtraColumns();
  return withAgentDatabase((db) => db.prepare(
    principalScopedProject("UPDATE projects SET status = 'archived', updated_at = ? WHERE id = ?", principalId)
  ).run(new Date().toISOString(), id, ...(principalId ? [principalId] : [])).changes > 0);
}

export function deleteProject(id: string, principalId?: string): boolean {
  ensureExtraColumns();
  return withAgentDatabase((db) => db.prepare(principalScopedProject("DELETE FROM projects WHERE id = ?", principalId)).run(id, ...(principalId ? [principalId] : [])).changes > 0);
}

/** Scope a projects statement to its owner; absent principalId keeps the
 * legacy unfiltered shape for the local stdio operator and internal callers. */
function principalScopedProject(sql: string, principalId?: string): string {
  return principalId ? `${sql} AND principal_id = ?` : sql;
}

export function listProjects(
  limit = 50,
  offset = 0,
  status?: "active" | "archived",
  principalId?: string,
): { items: Array<Record<string, unknown>>; total: number; hasMore: boolean } {
  ensureExtraColumns();
  return withAgentDatabase((db) => {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (status) { clauses.push("status = ?"); values.push(status); }
    if (principalId) { clauses.push("principal_id = ?"); values.push(principalId); }
    const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
    const total = (db.prepare(`SELECT COUNT(*) AS count FROM projects${where}`).get(...values) as { count: number }).count;
    const items = db.prepare(`SELECT * FROM projects${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(...values, limit, offset) as Array<Record<string, unknown>>;
    return { items, total, hasMore: offset + limit < total };
  });
}

// ─── Heartbeat ──────────────────────────────────────────────────────

export function updateTaskHeartbeat(taskId: string): void {
  ensureExtraColumns();
  withAgentDatabase(db=>db.transaction(()=>{
    assertTaskLeaseWrite(db,taskId);
    db.prepare("UPDATE tasks SET last_heartbeat = ? WHERE id = ?")
      .run(new Date().toISOString(),taskId);
  })());
}

// ─── Crash Recovery ─────────────────────────────────────────────────

// R3: legacy `checkpointing`/`resuming` folded into `executing` by migration 20.
const INTERRUPTED_STATES = ["executing", "recovering", "verifying", "waiting_approval"];

export function findInterruptedTasks():TaskPlan[] {
  ensureExtraColumns();
  return withAgentDatabase(db=>{
    // Query only the IDs: never build a partial TaskPlan in the recovery path.
    const ids=db.prepare(`
      SELECT id FROM tasks
      WHERE status IN (${INTERRUPTED_STATES.map(()=>"?").join(",")})
      ORDER BY updated_at ASC
    `).all(...INTERRUPTED_STATES) as Array<{id:string}>;
    return ids.map(row=>hydrateTaskById(db,row.id)).filter((plan):plan is TaskPlan=>plan!==null);
  });
}

export function markTaskRecovered(taskId: string): void {
  withAgentDatabase(db=>db.transaction(()=>{
    assertTaskLeaseWrite(db,taskId);
    db.prepare("UPDATE tasks SET status = 'executing', last_heartbeat = ? WHERE id = ?")
      .run(new Date().toISOString(),taskId);
  })());
}