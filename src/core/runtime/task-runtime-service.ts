import { approveRequest, getApprovalRequest, revokeTaskApprovals } from "../governance/approval-memory.js";
import { createLocalToolExecutor } from "../executor/local-tool-executor.js";
import { getTrustedInboundIdentity } from "./r2-trusted-inbound-identity.js";
import { runClosedAgentLoop, type ClosedLoopResult } from "../loop/closed-agent-loop.js";
import { resumeApprovedTask } from "../loop/resume-orchestrator.js";
import { getTaskPlan, findTaskByIdempotencyKey, listTasks, saveMemoryItem, saveTaskPlan } from "../memory/task-repository.js";
import { fingerprintTaskCreate } from "./r3-task-request-hash.js";
import type { TaskStep } from "../../application/dto/legacy-task-plan.js";
import { validateTaskPlan } from "../../application/services/legacy-task-plan-validator.js";
import { createTaskPlan } from "../planner/legacy-task-plan-factory.js";
import { createExecutionContext } from "./execution-context.js";
import { UnifiedTimelineService } from "../trace/unified-timeline-service.js";
import type { RecoveryProvider } from "../trace/unified-recovery-service.js";
import type { TaskState } from "../state/task-state-machine.js";
import { computeRecoveryMetrics } from "../trace/recovery-metrics.js";
import { analyzeTaskHistory } from "../reflection/reflection-engine.js";
import { getTaskReconciliations, recordTaskReconciliation, resolveTaskReconciliation, type ReconciliationFinding, type ReconciliationDecision } from "../recovery/task-reconciliation.js";
import { getAgentMetrics } from "../trace/metrics-service.js";
import { getWorkspaceRoot, listWorkspaceRoots, isUnrestrictedMode } from "../../security/workspace-guard.js";
import { resolveTaskWorkspace } from "../../security/task-workspace.js";
import { runWithWorkspaceScope } from "../../security/workspace-guard.js";
import {withTaskExecutionLease} from "./task-lease-runner.js";

export interface TaskRuntimeDependencies {
  createExecutor(correlationId: string, taskId: string): ReturnType<typeof createLocalToolExecutor>;
  recoveryProvider: RecoveryProvider;
  timeline: UnifiedTimelineService;
  recoveryRepository: import("../trace/recovery-repository.js").PersistentRecoveryRepository;
}

const runningTasks = new Set<string>();

export class TaskRuntimeService {
  constructor(private readonly dependencies: TaskRuntimeDependencies) {}

  /** R2: persisted identity/session is authoritative for all Task operations. */
  private assertTaskActor(plan: import("../../application/dto/legacy-task-plan.js").TaskPlan, effectful: boolean): void {
    const actor=getTrustedInboundIdentity();
    const context=plan.executionContext;
    if(context?.principalId && context.sessionId && context.origin) {
      if(context.principalId!==actor.principal.id ||
         context.sessionId!==actor.sessionId ||
         context.origin!==actor.principal.origin)
        throw new Error("task_principal_session_mismatch");
      return;
    }
    if(effectful || actor.principal.origin!=="local_stdio")
      throw new Error("task_principal_unbound");
  }

  private canReadTask(plan: import("../../application/dto/legacy-task-plan.js").TaskPlan): boolean {
    try { this.assertTaskActor(plan,false); return true; }
    catch { return false; }
  }

  create(input: { title: string; description?: string; steps: Array<Omit<TaskStep, "id" | "status"> & Partial<Pick<TaskStep, "id" | "status">>>; correlationId?: string; idempotencyKey?: string; retryPolicy?: { maxTotalAttempts?: number; maxConsecutiveFailures?: number } }) {
    const serialized = JSON.stringify(input);
    if (Buffer.byteLength(serialized, "utf8") > 8 * 1024 * 1024) throw new Error("Task plan exceeds the 8 MiB limit");
    const plan = createTaskPlan(input.title, input.steps, input.description);
    plan.correlationId = input.correlationId ?? crypto.randomUUID();
    plan.idempotencyKey = input.idempotencyKey;
    plan.state = "planning";
    plan.retryPolicy = input.retryPolicy;
    // Capture current workspace as immutable task execution context
    const identity=getTrustedInboundIdentity();
    plan.executionContext = {
      principalId:identity.principal.id,
      sessionId:identity.sessionId,
      origin:identity.principal.origin,
      scopes:[...identity.principal.scopes],
      workspace: getWorkspaceRoot(),
      roots: listWorkspaceRoots().map((r) => r.path),
      allowedRootsSnapshot: listWorkspaceRoots().map((r) => r.path),
      unrestricted: isUnrestrictedMode(),
      createdAt: new Date().toISOString(),
    };
    // The creation key binds the exact normalized payload and captured principal/session/scope.
    const key=input.idempotencyKey;
    if(key)plan.requestHash=fingerprintTaskCreate(plan);
    const loadExisting=()=>{
      if(!key)return undefined;
      const existingId=findTaskByIdempotencyKey(key);
      if(!existingId)return undefined;
      const existing=getTaskPlan(existingId);
      if(!existing)throw new Error("idempotency_key_inconsistent");
      this.assertTaskActor(existing,true);
      if(!existing.requestHash)throw new Error("idempotency_key_legacy_hash_missing");
      if(existing.requestHash!==plan.requestHash)throw new Error("idempotency_key_payload_conflict");
      return existing;
    };
    const prior=loadExisting();
    if(prior)return prior;
    try{saveTaskPlan(plan,plan.state,plan.correlationId);}
    catch(error){
      if(!key||!(error instanceof Error)||
         !/UNIQUE constraint failed: tasks.idempotency_key/.test(error.message))throw error;
      const concurrent=loadExisting();
      if(concurrent)return concurrent;
      throw error;
    }
    saveMemoryItem({
      taskId: plan.id, kind: "task_created",
      content: { title: plan.task, steps: plan.steps.length, workspace: plan.executionContext.workspace },
      // Attribute the lifecycle note to the task's owner, not the shared
      // local-stdio bucket, so it stays with the principal who created it.
      principalId: plan.executionContext.principalId,
    });
    return plan;
  }

  get(taskId: string) {
    const plan=getTaskPlan(taskId);
    if(plan) this.assertTaskActor(plan,false);
    return plan;
  }
  list(limit?: number) {
    return listTasks(limit).filter(row=>{
      const plan=getTaskPlan(String(row.id));
      return !!plan && this.canReadTask(plan);
    });
  }

  async run(taskId: string, maxRecovery = 1, options?: { timeoutMs?: number; maxRecovery?: number }): Promise<ClosedLoopResult> {
    if (runningTasks.has(taskId)) throw new Error("Task is already running");
    runningTasks.add(taskId);
    try {
    // Read identity first, but hydrate again under the durable cross-process
    // lease so a plan created/modified by the previous holder is never reused.
    const original=getTaskPlan(taskId);
    if(!original)throw new Error("Task not found");
    this.assertTaskActor(original,true);
    return await withTaskExecutionLease(taskId,async()=>{
    const plan=getTaskPlan(taskId);
    if(!plan)throw new Error("Task not found");
    this.assertTaskActor(plan,true);
    validateTaskPlan(plan);

    if(plan.steps.some(step=>step.status==="outcome_unknown"))
      throw new Error("outcome_unknown_requires_reconciliation");
    // Terminal state without pending steps: return structured no-op
    // Cancelled tasks always return no-op — pending steps cannot be executed
    // on a cancelled task (use task_append_steps to reopen first).
    if (plan.state === "cancelled") {
      return { status: "cancelled" as const, plan, completedSteps: plan.steps.filter((s) => s.status === "completed"), correlationId: plan.correlationId ?? "" };
    }
    if (plan.state === "completed") {
      const hasPending = plan.steps.some((s) => s.status === "pending" || s.status === "failed" || s.status === "outcome_unknown");
      if (!hasPending) return { status: "completed" as const, plan, completedSteps: plan.steps.filter((s) => s.status === "completed"), correlationId: plan.correlationId ?? "" };
    }

    // Idempotent: all steps done returns structured no-op
    const allComplete = plan.steps.every((s) => s.status === "completed" || s.status === "cancelled");
    if (allComplete) {
      return { status: "completed" as const, plan, completedSteps: plan.steps.filter((s) => s.status === "completed"), correlationId: plan.correlationId ?? "" };
    }

    // Find the first step that can be executed (TR-02: never skip completed steps).
    // Prioritize pending steps over failed ones — corrective appends add pending
    // steps that should run before re-executing previously-failed steps.
    const pendingIndex = plan.steps.findIndex((step) => step.status === "pending");
    const retryableIndex = plan.steps.findIndex((step) =>
      step.status === "failed" ||
      step.status === "outcome_unknown" ||
      step.status === "pending_approval"
    );
    const startIndex = pendingIndex >= 0 ? pendingIndex : retryableIndex;
    if (startIndex < 0) {
      // No executable steps — idempotent
      return { status: "completed" as const, plan, completedSteps: plan.steps.filter((s) => s.status === "completed"), correlationId: plan.correlationId ?? "" };
    }
    if (plan.steps[startIndex].status === "outcome_unknown") {
      throw new Error(`Step ${plan.steps[startIndex].id} has outcome_unknown status and requires reconciliation before retry`);
    }
    if (plan.steps[startIndex].status === "pending_approval") throw new Error("Task has a pending approval; approve and resume it instead");
    // Dependency check: allow pending (corrective) steps to proceed even if
    // their dependency failed — corrective steps are explicitly meant to run
    // after failures (TR-01/TR-04).
    const isCorrectiveStep = plan.steps[startIndex].status === "pending" && plan.steps[startIndex].dependsOn?.length;
    for (const dependency of plan.steps[startIndex].dependsOn ?? []) {
      const depStep = plan.steps.find((step) => step.id === dependency);
      if (!depStep) throw new Error(`Dependency ${dependency} not found`);
      const depCompleted = depStep.status === "completed" || depStep.status === "reconciled_succeeded";
      const depFailedAndCorrective = !depCompleted && isCorrectiveStep && (depStep.status === "failed" || depStep.status === "outcome_unknown");
      if (!depCompleted && !depFailedAndCorrective) throw new Error(`Dependency ${dependency} is not completed`);
    }

    // Check cumulative retry policy
    plan.totalRunCount = (plan.totalRunCount ?? 0) + 1;
    if (plan.retryPolicy?.maxTotalAttempts && plan.totalRunCount > plan.retryPolicy.maxTotalAttempts) {
      throw new Error(`Task exceeded maximum total attempts (${plan.retryPolicy.maxTotalAttempts}). Increase retryPolicy.maxTotalAttempts or create a new task.`);
    }
    // Enforce the persisted consecutive-failure budget at the STEP level:
    // a step that has already failed this many times in a row will not be
    // retried again without an explicit corrective plan.
    // However, if the step is `pending` (a corrective step appended after
    // reopening), bypass the budget check — corrective revisions are
    // independent continuations (TR-04/TR-13).
    const budget = plan.retryPolicy?.maxConsecutiveFailures;
    if (budget && plan.steps[startIndex].status !== "pending") {
      const startStep = plan.steps[startIndex];
      if ((startStep.failedAttempts ?? 0) >= budget) {
        throw new Error(`Step ${startStep.id} already failed ${startStep.failedAttempts} times (maxConsecutiveFailures=${budget}). Provide a corrective plan (task_append_steps) before re-running.`);
      }
    }

    const effectiveMaxRecovery = options?.maxRecovery ?? maxRecovery;
    if (options?.timeoutMs !== undefined && plan.steps[startIndex].timeout === undefined) {
      plan.steps[startIndex].timeout = options.timeoutMs;
    }
    const context = createExecutionContext({ taskId, correlationId: plan.correlationId });
    const executor = createLocalToolExecutor(context.correlationId, taskId, plan.executionContext);
    const resolvedWorkspace = resolveTaskWorkspace(plan.executionContext);
    plan.maxRecovery = effectiveMaxRecovery;
    const execute = () => runClosedAgentLoop(plan, executor, effectiveMaxRecovery, startIndex, context, this.dependencies.recoveryProvider);
    const result = await (resolvedWorkspace.workspace
      ? runWithWorkspaceScope(resolvedWorkspace.workspace, execute)
      : execute());
    saveTaskPlan(plan, plan.state ?? result.status as TaskState, context.correlationId);
    saveMemoryItem({ taskId, kind: "task_run", content: { status: result.status, completedSteps: result.completedSteps.map((step) => step.id), runCount: plan.totalRunCount }, principalId: plan.executionContext?.principalId });
    return result;
    });
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
    if (!plan) return {approved:false,reason:"task_not_found"};
    this.assertTaskActor(plan,true);
    if (plan.state === "cancelled") {
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
    this.assertTaskActor(plan,true);
    if (plan.state === "completed" || plan.state === "cancelled") return false;
    plan.state = "cancelled";
    saveTaskPlan(plan, plan.state, plan.correlationId);
    // Revoke all pending/approved-but-unconsumed approvals so stale approvals
    // cannot resurrect a cancelled task via task_approve + task_resume.
    const revokedCount = revokeTaskApprovals(taskId);
    saveMemoryItem({ taskId, kind: "task_cancelled", content: { state: plan.state, approvalsRevoked: revokedCount }, principalId: plan.executionContext?.principalId });
    return true;
  }

  async resume(approvalId: number): Promise<ClosedLoopResult> {
    const approval = getApprovalRequest(approvalId);
    if (!approval) throw new Error("Approval not found");
    const plan = getTaskPlan(approval.task_id);
    if (!plan) throw new Error("Task not found");
    this.assertTaskActor(plan,true);
    // Terminal approval states: don't consume, return structured response
    if (approval.status === "consumed") {
      return { status: "not_resumable", approvalId, reason: "approval_already_consumed", plan, completedSteps: plan.steps.filter((s) => s.status === "completed"), correlationId: plan.correlationId ?? approval.correlation_id ?? "" };
    }
    if (approval.status === "revoked") {
      return { status: "not_resumable", approvalId, reason: "approval_revoked", plan, completedSteps: plan.steps.filter((s) => s.status === "completed"), correlationId: plan.correlationId ?? approval.correlation_id ?? "" };
    }
    if (approval.status === "pending") {
      return { status: "not_resumable", approvalId, reason: "approval_not_yet_approved", plan, completedSteps: plan.steps.filter((s) => s.status === "completed"), correlationId: plan.correlationId ?? approval.correlation_id ?? "" };
    }
    if (plan.state === "cancelled") {
      return { status: "not_resumable", approvalId, reason: "task_cancelled", plan, completedSteps: plan.steps.filter((s) => s.status === "completed"), correlationId: plan.correlationId ?? approval.correlation_id ?? "" };
    }
    if (plan.state === "completed") {
      return { status: "not_resumable", approvalId, reason: "task_already_completed", plan, completedSteps: plan.steps.filter((s) => s.status === "completed"), correlationId: plan.correlationId ?? approval.correlation_id ?? "" };
    }
    if (runningTasks.has(plan.id)) throw new Error("Task is already running");
    runningTasks.add(plan.id);
    try {
    return await withTaskExecutionLease(plan.id,async()=>{
    const freshApproval=getApprovalRequest(approvalId);
    const freshPlan=getTaskPlan(plan.id);
    if(!freshPlan||!freshApproval||freshApproval.status!=="approved"||
      freshPlan.state==="cancelled"||freshPlan.state==="completed")
      return {status:"not_resumable" as const,approvalId,
        reason:"approval_or_task_no_longer_resumable",
        plan,completedSteps:plan.steps.filter(s=>s.status==="completed"),
        correlationId:plan.correlationId??approval.correlation_id??""};
    this.assertTaskActor(freshPlan,true);
    const resumedPlan=freshPlan;
    const resolvedWorkspace = resolveTaskWorkspace(resumedPlan.executionContext);
    const executor = createLocalToolExecutor(resumedPlan.correlationId ?? approval.correlation_id ?? crypto.randomUUID(), resumedPlan.id, resumedPlan.executionContext);
    const execute = () => resumeApprovedTask(approvalId, resumedPlan, executor, this.dependencies.recoveryProvider);
    const result = await (resolvedWorkspace.workspace
      ? runWithWorkspaceScope(resolvedWorkspace.workspace, execute)
      : execute());
    if (!result) {
      // Approval consumed or not resumable — return structured response
      return { status: "not_resumable", approvalId, reason: "approval_cannot_resume", plan:resumedPlan, completedSteps: resumedPlan.steps.filter((s) => s.status === "completed"), correlationId: resumedPlan.correlationId ?? approval.correlation_id ?? "" };
    }
    // Clear the pending approval pointer after consumption (TR-10).
    // The approval record itself is immutable in approval_requests for audit.
    result.plan.pendingApproval = undefined;
    saveTaskPlan(resumedPlan, resumedPlan.state ?? result.status as TaskState, result.correlationId);
    return result;
    });
    } finally {
      runningTasks.delete(plan.id);
    }
  }

  reconcile(input:{
    taskId:string;stepId:number;finding:ReconciliationFinding;
    evidence:string;verificationTaskId?:string;decision?:ReconciliationDecision;
  }) {
    const plan=getTaskPlan(input.taskId);
    if(!plan)throw new Error("Task not found");
    this.assertTaskActor(plan,true);
    if(runningTasks.has(plan.id))throw new Error("Task is already running");
    return input.decision
      ?resolveTaskReconciliation(input as typeof input & {decision:ReconciliationDecision})
      :recordTaskReconciliation(input);
  }

  report(taskId: string) {
    const plan = getTaskPlan(taskId);
    if (!plan) throw new Error("Task not found");
    this.assertTaskActor(plan,false);
    const correlationId = plan.correlationId;
    if (!correlationId) throw new Error("Task has no correlation ID");
    const timeline = this.dependencies.timeline.build(correlationId);
    
    const completedNow = plan.steps.filter((s) => s.status === "completed").length;
    // failedSteps = steps currently terminal-failed or outcome_unknown (TR-07)
    const failedNow = plan.steps.filter((s) => s.status === "failed" || s.status === "outcome_unknown").length;
    const blockedNow = plan.steps.filter((s) => s.status === "blocked").length;
    const pendingApprovalNow = plan.steps.filter((s) => s.status === "pending_approval").length;

    // Historical failure analysis from timeline events (TR-08)
    const timelineEvents = timeline.events ?? [];
    const historicalFailures = timelineEvents.filter((e) => {
      const d = e.data as Record<string, unknown> | undefined;
      return e.type === "execution" && d?.status === "failed" && typeof d?.stepId === "number";
    });
    // recoveredSteps: steps that failed at least once but are now completed
    const recoveredSteps = new Set(
      historicalFailures
        .map((e) => (e.data as Record<string, unknown>).stepId as number)
        .filter((stepId) => {
          const step = plan.steps.find((s) => s.id === stepId);
          return step && step.status === "completed";
        })
    ).size;

    // Collect retried step IDs (steps that appear as failed at least once)
    const retriedSteps = [...new Set(historicalFailures.map((e) => (e.data as Record<string, unknown>).stepId as number))];

    // Recovery metrics from timeline events — single source of truth (OBS-01/OBS-02)
    const recoveryMetrics = computeRecoveryMetrics(plan, timelineEvents);

    // everFailed: true if any step has failed, or task ended in failed state (TR-07)
    // Also check step-level failedAttempts for cases where timeline events are sparse.
    const stepFailedAttempts = plan.steps.reduce((sum, s) => sum + (s.failedAttempts ?? 0), 0);
    const hasStepFailures = plan.steps.some((s) => s.status === "failed" || s.status === "outcome_unknown" || (s.failedAttempts ?? 0) > 0);
    const everFailed = historicalFailures.length > 0 || hasStepFailures || plan.state === "failed";

    return {
      task: plan,
      status: plan.state ?? timeline.finalStatus,
      taskStatus: plan.state,
      completedSteps: completedNow,
      failedSteps: failedNow,
      blockedSteps: blockedNow,
      pendingApprovalSteps: pendingApprovalNow,
      historicalFailedAttempts: Math.max(historicalFailures.length, stepFailedAttempts),
      recoveredSteps,
      retriedSteps,
      everFailed,
      // Recovery metrics — single source of truth via computeRecoveryMetrics (OBS-01/OBS-02)
      recoveryAttempts: recoveryMetrics.recoveryAttempts,
      successfulRecoveries: recoveryMetrics.successfulRecoveries,
      failedRecoveries: recoveryMetrics.failedRecoveries,
      recoverySuccessRate: recoveryMetrics.recoverySuccessRate,
      timeline,
      reflection: analyzeTaskHistory(taskId),
      reconciliations: getTaskReconciliations(taskId),
      // Override agent_metrics recovery fields with the correct values from
      // the shared helper so task_report top-level and nested metrics match.
      metrics: {
        ...getAgentMetrics({ taskId, limit: 100, offset: 0 }),
        recoveryAttempts: recoveryMetrics.recoveryAttempts,
        successfulRecoveries: recoveryMetrics.successfulRecoveries,
        failedRecoveries: recoveryMetrics.failedRecoveries,
        recoverySuccessRate: recoveryMetrics.recoverySuccessRate,
      }
    };
  }
}