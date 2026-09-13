import { approveRequest, getApprovalRequest, revokeTaskApprovals } from "../governance/approval-memory.js";
import { createLocalToolExecutor } from "../executor/local-tool-executor.js";
import { runClosedAgentLoop, type ClosedLoopResult } from "../loop/closed-agent-loop.js";
import { resumeApprovedTask } from "../loop/resume-orchestrator.js";
import { getTaskPlan, listTasks, saveMemoryItem, saveTaskPlan } from "../memory/task-repository.js";
import { createTaskPlan, type TaskStep, validateTaskPlan } from "../planner/task-planner.js";
import { createExecutionContext } from "./execution-context.js";
import { UnifiedTimelineService } from "../trace/unified-timeline-service.js";
import type { RecoveryProvider } from "../trace/unified-recovery-service.js";
import type { TaskState } from "../state/task-state-machine.js";
import { analyzeTaskHistory } from "../reflection/reflection-engine.js";
import { getAgentMetrics } from "../trace/metrics-service.js";
import { getWorkspaceRoot, listWorkspaceRoots, isUnrestrictedMode } from "../../security/workspace-guard.js";

export interface TaskRuntimeDependencies {
  createExecutor(correlationId: string, taskId: string): ReturnType<typeof createLocalToolExecutor>;
  recoveryProvider: RecoveryProvider;
  timeline: UnifiedTimelineService;
  recoveryRepository: import("../trace/recovery-repository.js").PersistentRecoveryRepository;
}

const runningTasks = new Set<string>();

export class TaskRuntimeService {
  constructor(private readonly dependencies: TaskRuntimeDependencies) {}

  create(input: { title: string; description?: string; steps: Array<Omit<TaskStep, "id" | "status"> & Partial<Pick<TaskStep, "id" | "status">>>; correlationId?: string; idempotencyKey?: string; retryPolicy?: { maxTotalAttempts?: number; maxConsecutiveFailures?: number } }) {
    const serialized = JSON.stringify(input);
    if (Buffer.byteLength(serialized, "utf8") > 8 * 1024 * 1024) throw new Error("Task plan exceeds the 8 MiB limit");
    const plan = createTaskPlan(input.title, input.steps, input.description);
    plan.correlationId = input.correlationId ?? crypto.randomUUID();
    plan.idempotencyKey = input.idempotencyKey;
    plan.state = "planning";
    plan.retryPolicy = input.retryPolicy;
    // Capture current workspace as immutable task execution context
    plan.executionContext = {
      workspace: getWorkspaceRoot(),
      roots: listWorkspaceRoots().map((r) => r.path),
      unrestricted: isUnrestrictedMode(),
    };
    saveTaskPlan(plan, plan.state, plan.correlationId);
    saveMemoryItem({ taskId: plan.id, kind: "task_created", content: { title: plan.task, steps: plan.steps.length, workspace: plan.executionContext.workspace } });
    return plan;
  }

  get(taskId: string) { return getTaskPlan(taskId); }
  list(limit?: number) { return listTasks(limit); }

  async run(taskId: string, maxRecovery = 1): Promise<ClosedLoopResult> {
    if (runningTasks.has(taskId)) throw new Error("Task is already running");
    runningTasks.add(taskId);
    try {
    const plan = getTaskPlan(taskId);
    if (!plan) throw new Error("Task not found");
    validateTaskPlan(plan);

    // Terminal state: return structured no-op instead of throwing
    if (plan.state === "cancelled") {
      return { status: "cancelled" as const, plan, completedSteps: plan.steps.filter((s) => s.status === "completed"), correlationId: plan.correlationId ?? "" };
    }
    if (plan.state === "completed") {
      return { status: "completed" as const, plan, completedSteps: plan.steps.filter((s) => s.status === "completed"), correlationId: plan.correlationId ?? "" };
    }

    // Idempotent: all steps done returns structured no-op
    const allComplete = plan.steps.every((s) => s.status === "completed" || s.status === "cancelled");
    if (allComplete) {
      return { status: "completed" as const, plan, completedSteps: plan.steps.filter((s) => s.status === "completed"), correlationId: plan.correlationId ?? "" };
    }

    const startIndex = plan.steps.findIndex((step) => step.status !== "completed" && step.status !== "cancelled");
    if (startIndex < 0) {
      // All steps completed or cancelled — idempotent
      return { status: "completed" as const, plan, completedSteps: plan.steps.filter((s) => s.status === "completed"), correlationId: plan.correlationId ?? "" };
    }
    if (plan.steps[startIndex].status === "pending_approval") throw new Error("Task has a pending approval; approve and resume it instead");
    for (const dependency of plan.steps[startIndex].dependsOn ?? []) {
      if (plan.steps.find((step) => step.id === dependency)?.status !== "completed") throw new Error(`Dependency ${dependency} is not completed`);
    }

    // Check cumulative retry policy
    plan.totalRunCount = (plan.totalRunCount ?? 0) + 1;
    if (plan.retryPolicy?.maxTotalAttempts && plan.totalRunCount > plan.retryPolicy.maxTotalAttempts) {
      throw new Error(`Task exceeded maximum total attempts (${plan.retryPolicy.maxTotalAttempts}). Increase retryPolicy.maxTotalAttempts or create a new task.`);
    }
    // Enforce the persisted consecutive-failure budget at the STEP level:
    // a step that has already failed this many times in a row will not be
    // retried again without an explicit corrective plan.
    const budget = plan.retryPolicy?.maxConsecutiveFailures;
    if (budget) {
      const startStep = plan.steps[startIndex];
      if ((startStep.failedAttempts ?? 0) >= budget) {
        throw new Error(`Step ${startStep.id} already failed ${startStep.failedAttempts} times (maxConsecutiveFailures=${budget}). Provide a corrective plan (task_append_steps) before re-running.`);
      }
    }

    const context = createExecutionContext({ taskId, correlationId: plan.correlationId });
    const executor = createLocalToolExecutor(context.correlationId, taskId, plan.executionContext);
    plan.maxRecovery = maxRecovery;
    const result = await runClosedAgentLoop(plan, executor, maxRecovery, startIndex, context, this.dependencies.recoveryProvider);
    saveTaskPlan(plan, plan.state ?? result.status as TaskState, context.correlationId);
    saveMemoryItem({ taskId, kind: "task_run", content: { status: result.status, completedSteps: result.completedSteps.map((step) => step.id), runCount: plan.totalRunCount } });
    return result;
    } finally {
      runningTasks.delete(taskId);
    }
  }

  approve(approvalId: number): { approved: boolean; reason?: string } {
    const req = getApprovalRequest(approvalId);
    if (!req) return { approved: false, reason: "approval_not_found" };
    if (req.status === "revoked") return { approved: false, reason: "approval_revoked" };
    if (req.status === "consumed") return { approved: false, reason: "approval_already_consumed" };
    const plan = getTaskPlan(req.task_id);
    if (plan?.state === "cancelled") {
      // Still revoke the approval for audit consistency
      revokeTaskApprovals(req.task_id);
      return { approved: false, reason: "task_cancelled" };
    }
    return { approved: approveRequest(approvalId) };
  }

  cancel(taskId: string): boolean {
    if (runningTasks.has(taskId)) throw new Error("A running task cannot be cancelled until its current tool call finishes");
    const plan = getTaskPlan(taskId);
    if (!plan) throw new Error("Task not found");
    if (plan.state === "completed" || plan.state === "cancelled") return false;
    plan.state = "cancelled";
    saveTaskPlan(plan, plan.state, plan.correlationId);
    // Revoke all pending/approved-but-unconsumed approvals so stale approvals
    // cannot resurrect a cancelled task via task_approve + task_resume.
    const revokedCount = revokeTaskApprovals(taskId);
    saveMemoryItem({ taskId, kind: "task_cancelled", content: { state: plan.state, approvalsRevoked: revokedCount } });
    return true;
  }

  async resume(approvalId: number): Promise<ClosedLoopResult | { status: "not_resumable"; approvalId: number; reason: string }> {
    const approval = getApprovalRequest(approvalId);
    if (!approval) throw new Error("Approval not found");
    const plan = getTaskPlan(approval.task_id);
    if (!plan) throw new Error("Task not found");
    // Terminal approval states: don't consume, return structured response
    if (approval.status === "consumed") {
      return { status: "not_resumable" as const, approvalId, reason: "approval_already_consumed" };
    }
    if (approval.status === "revoked") {
      return { status: "not_resumable" as const, approvalId, reason: "approval_revoked" };
    }
    if (approval.status === "pending") {
      return { status: "not_resumable" as const, approvalId, reason: "approval_not_yet_approved" };
    }
    if (plan.state === "cancelled") {
      return { status: "not_resumable" as const, approvalId, reason: "task_cancelled" };
    }
    if (plan.state === "completed") {
      return { status: "not_resumable" as const, approvalId, reason: "task_already_completed" };
    }
    if (runningTasks.has(plan.id)) throw new Error("Task is already running");
    runningTasks.add(plan.id);
    try {
    const executor = createLocalToolExecutor(plan.correlationId ?? approval.correlation_id ?? crypto.randomUUID(), plan.id, plan.executionContext);
    const result = await resumeApprovedTask(approvalId, plan, executor, this.dependencies.recoveryProvider);
    if (!result) {
      // Approval consumed or not resumable — return structured response
      return { status: "not_resumable" as const, approvalId, reason: "approval_cannot_resume" };
    }
    saveTaskPlan(plan, plan.state ?? result.status as TaskState, result.correlationId);
    return result;
    } finally {
      runningTasks.delete(plan.id);
    }
  }

  report(taskId: string) {
    const plan = getTaskPlan(taskId);
    if (!plan) throw new Error("Task not found");
    const correlationId = plan.correlationId;
    if (!correlationId) throw new Error("Task has no correlation ID");
    const timeline = this.dependencies.timeline.build(correlationId);
    
    // Count historical failures from timeline (steps that were failed then recovered)
    const completedNow = plan.steps.filter((s) => s.status === "completed").length;
    const failedNow = plan.steps.filter((s) => s.status === "failed").length;
    const blockedNow = plan.steps.filter((s) => s.status === "blocked").length;
    const pendingApprovalNow = plan.steps.filter((s) => s.status === "pending_approval").length;
    // Count steps that appear in timeline as failed (historical attempts)
    const timelineEvents = timeline.events ?? [];
    const historicalFailures = timelineEvents.filter((e) => {
      const d = e.data as Record<string, unknown> | undefined;
      return e.type === "execution" && d?.status === "failed" && typeof d?.stepId === "number";
    });
    const recoveredSteps = new Set(
      timelineEvents
        .filter((e) => {
          const d = e.data as Record<string, unknown> | undefined;
          return e.type === "execution" && d?.status === "failed" && typeof d?.stepId === "number";
        })
        .filter((e) => {
          const d = e.data as Record<string, unknown>;
          const stepId = d.stepId as number;
          const step = plan.steps.find((s) => s.id === stepId);
          return step && step.status === "completed";
        })
        .map((e) => (e.data as Record<string, unknown>).stepId as number)
    ).size;
    
    // Collect retried step IDs (steps that appear as failed then later completed)
    const retriedSteps = [...new Set(
      timelineEvents
        .filter((e) => {
          const d = e.data as Record<string, unknown> | undefined;
          return e.type === "execution" && d?.status === "failed" && typeof d?.stepId === "number";
        })
        .map((e) => (e.data as Record<string, unknown>).stepId as number)
    )];

    return {
      task: plan,
      // Prefer the persisted plan state; the timeline-derived status can be
      // "unknown" when no task row landed in the trace for this correlation id.
      status: plan.state ?? timeline.finalStatus,
      taskStatus: plan.state,
      completedSteps: completedNow,
      failedSteps: failedNow,
      blockedSteps: blockedNow,
      pendingApprovalSteps: pendingApprovalNow,
      historicalFailedAttempts: historicalFailures.length,
      recoveredSteps,
      retriedSteps,
      everFailed: historicalFailures.length > 0,
      timeline,
      reflection: analyzeTaskHistory(taskId),
      metrics: getAgentMetrics({ taskId, limit: 100, offset: 0 })
    };
  }
}
