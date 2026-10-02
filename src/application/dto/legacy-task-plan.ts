import type { ToolName } from "../services/legacy-tool-orchestrator.js";
import type { TaskState } from "../../domain/task/task.js";
import type { ExecutionReceipt } from "../../domain/task/execution-outcome.js";

export type TaskStepStatus = "pending" | "running" | "completed" | "failed" | "pending_approval" | "blocked" | "cancelled" | "outcome_unknown" | "reconciled_succeeded" | "reconciled_failed";
export type StepRunCondition = "success" | "failure" | "always";
export interface StepAttempt {
  attempt: number;
  status: "failed" | "completed" | "cancelled";
  error?: string;
  timestamp: string;
}
export interface TaskStep {
  id: number;
  action: string;
  status: TaskStepStatus;
  tool?: ToolName;
  arguments?: Record<string, unknown>;
  dependsOn?: number[];
  runWhen?: StepRunCondition;
  output?: unknown;
  error?: string;
  errorType?: string;
  timeout?: number;
  attempts?: number;
  failedAttempts?: number;
  attemptHistory?: StepAttempt[];
  templateArguments?: Record<string, unknown>;
  /** Canonical, durable record of the latest attempted mutation; read-only steps omit it. */
  lastReceipt?: ExecutionReceipt;
}
export interface TaskExecutionContext {
  /** Immutable trusted identity copied when the Task is created. */
  principalId?: string;
  sessionId?: string;
  origin?: "local_stdio" | "http_oauth";
  scopes?: string[];
  workspace: string | null;
  allowedRootsSnapshot?: string[];
  roots: string[];
  unrestricted: boolean;
  createdAt?: string;
}
export interface RetryPolicy {
  maxTotalAttempts?: number;
  maxConsecutiveFailures?: number;
}
export interface TaskPlan {
  id: string;
  task: string;
  description?: string;
  correlationId?: string;
  idempotencyKey?: string;
  /** SHA-256 fingerprint of the canonical initial payload and bound execution scope. */
  requestHash?: string;
  state?: TaskState;
  steps: TaskStep[];
  executionContext?: TaskExecutionContext;
  maxRecovery?: number;
  /** Persisted aggregate revision; concurrency fencing belongs to R3.07. */
  revision?: number;
  /** Repository-owned timestamps; modified on each durable Task write. */
  createdAt?: string;
  updatedAt?: string;
  retryPolicy?: RetryPolicy;
  totalRunCount?: number;
  /** The Project this Task belongs to. Optional: tasks predating the direct
   *  binding (migration 21) and tasks created without a project context have
   *  none; task_list(projectId) filters on it. */
  projectId?: string;
  pendingApproval?: {
    approvalId: number;
    stepId: number;
    action: string;
    risk: string;
    reason: string;
  };
}
export interface TemplateValidationError {
  stepId: number;
  argumentPath: string;
  template: string;
  reason: "unknown_step_reference" | "self_reference" | "future_step_reference";
}