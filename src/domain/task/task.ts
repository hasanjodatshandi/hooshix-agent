import { DomainError } from "../shared/errors.js";
import type { CorrelationId, IdempotencyKey, StepId, TaskId, ToolId } from "../shared/ids.js";
import type { ExecutionReceipt } from "./execution-outcome.js";
import type { WorkspaceScope } from "../workspace/workspace-scope.js";
export type TaskState = "planning" | "ready" | "executing" | "waiting_approval" | "reconciling" | "recovering" | "verifying" | "completed" | "failed" | "cancelled";
export type StepState = "pending" | "running" | "pending_approval" | "blocked" | "succeeded" | "failed" | "outcome_unknown" | "reconciled_succeeded" | "reconciled_failed" | "skipped" | "cancelled";
export type RunWhen = "success" | "failure" | "always";
export interface AttemptRecord { readonly attempt: number; readonly at: string; readonly status: StepState; readonly error?: string; }
export interface TaskStep {
  readonly id: StepId;
  readonly action: string;
  readonly toolId: ToolId;
  readonly arguments: unknown;
  readonly originalTemplateArguments?: unknown;
  readonly dependencies: readonly StepId[];
  readonly runWhen: RunWhen;
  readonly timeoutMs: number;
  readonly state: StepState;
  readonly attempts: number;
  readonly failedAttempts: number;
  readonly attemptHistory: readonly AttemptRecord[];
  readonly idempotencyKey?: IdempotencyKey;
  readonly lastReceipt?: ExecutionReceipt;
  readonly output?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
}
export interface Task {
  readonly id: TaskId;
  readonly title: string;
  readonly description?: string;
  readonly state: TaskState;
  readonly correlationId: CorrelationId;
  readonly steps: readonly TaskStep[];
  readonly executionScope: WorkspaceScope;
  readonly retryPolicy: { readonly maxAttempts: number };
  readonly totalRunCount: number;
  readonly idempotency?: { readonly key: IdempotencyKey; readonly requestHash: string };
  readonly createdAt: string;
  readonly updatedAt: string;
}
export function assertTaskInvariants(task: Task): void {
  if (!task.id || !task.title.trim() || task.totalRunCount < 0 || task.retryPolicy.maxAttempts < 1) throw new DomainError("INVALID_TASK", "Invalid task metadata");
  if (!task.executionScope.principalId || !task.executionScope.sessionId) throw new DomainError("INVALID_TASK", "Task must capture a principal-scoped workspace");
  const ids = new Set<number>();
  for (const step of task.steps) {
    if (ids.has(step.id)) throw new DomainError("DUPLICATE_STEP", "Duplicate step identifier");
    ids.add(step.id);
    if (!step.action.trim() || !step.toolId || !["success","failure","always"].includes(step.runWhen) ||
        !Number.isSafeInteger(step.timeoutMs) || step.timeoutMs <= 0 ||
        !Number.isSafeInteger(step.attempts) || step.attempts < 0 ||
        !Number.isSafeInteger(step.failedAttempts) || step.failedAttempts < 0) {
      throw new DomainError("INVALID_TASK", "Invalid task step");
    }
  }
  for (const step of task.steps) for (const dependency of step.dependencies) {
    if (!ids.has(dependency)) throw new DomainError("MISSING_DEPENDENCY", "Unknown step dependency");
    if (dependency === step.id) throw new DomainError("CYCLIC_DEPENDENCY", "Self dependency");
  }
  const visiting = new Set<number>(), visited = new Set<number>();
  const byId = new Map(task.steps.map(s => [s.id as number, s]));
  function visit(id: number): void {
    if (visiting.has(id)) throw new DomainError("CYCLIC_DEPENDENCY", "Cyclic task plan");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)!.dependencies) visit(dependency);
    visiting.delete(id); visited.add(id);
  }
  for (const id of ids) visit(id);
}
export function assertAppendAllowed(task: Task): void {
  if (task.state === "completed" || task.state === "cancelled") throw new DomainError("TASK_TERMINAL", "Cannot append to terminal task");
  if (task.steps.some(s => s.state === "outcome_unknown")) throw new DomainError("OUTCOME_UNRESOLVED", "Reconcile unknown outcome before appending");
}
