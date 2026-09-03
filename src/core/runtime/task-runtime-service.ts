import { approveRequest, getApprovalRequest } from "../governance/approval-memory.js";
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

export interface TaskRuntimeDependencies {
  createExecutor(correlationId: string, taskId: string): ReturnType<typeof createLocalToolExecutor>;
  recoveryProvider: RecoveryProvider;
  timeline: UnifiedTimelineService;
}

const runningTasks = new Set<string>();

export class TaskRuntimeService {
  constructor(private readonly dependencies: TaskRuntimeDependencies) {}

  create(input: { title: string; description?: string; steps: Array<Omit<TaskStep, "id" | "status"> & Partial<Pick<TaskStep, "id" | "status">>>; correlationId?: string }) {
    const serialized = JSON.stringify(input);
    if (Buffer.byteLength(serialized, "utf8") > 8 * 1024 * 1024) throw new Error("Task plan exceeds the 8 MiB limit");
    const plan = createTaskPlan(input.title, input.steps, input.description);
    plan.correlationId = input.correlationId ?? crypto.randomUUID();
    plan.state = "planning";
    saveTaskPlan(plan, plan.state, plan.correlationId);
    saveMemoryItem({ taskId: plan.id, kind: "task_created", content: { title: plan.task, steps: plan.steps.length } });
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
    const startIndex = plan.steps.findIndex((step) => step.status !== "completed");
    if (startIndex < 0) throw new Error("Task is already completed");
    if (plan.steps[startIndex].status === "pending_approval") throw new Error("Task has a pending approval; approve and resume it instead");
    for (const dependency of plan.steps[startIndex].dependsOn ?? []) {
      if (plan.steps.find((step) => step.id === dependency)?.status !== "completed") throw new Error(`Dependency ${dependency} is not completed`);
    }
    const context = createExecutionContext({ taskId, correlationId: plan.correlationId });
    const result = await runClosedAgentLoop(plan, this.dependencies.createExecutor(context.correlationId, taskId), maxRecovery, startIndex, context, this.dependencies.recoveryProvider);
    saveTaskPlan(plan, plan.state ?? result.status as TaskState, context.correlationId);
    saveMemoryItem({ taskId, kind: "task_run", content: { status: result.status, completedSteps: result.completedSteps.map((step) => step.id) } });
    return result;
    } finally {
      runningTasks.delete(taskId);
    }
  }

  approve(approvalId: number): boolean { return approveRequest(approvalId); }

  cancel(taskId: string): boolean {
    if (runningTasks.has(taskId)) throw new Error("A running task cannot be cancelled until its current tool call finishes");
    const plan = getTaskPlan(taskId);
    if (!plan) throw new Error("Task not found");
    if (plan.state === "completed" || plan.state === "cancelled") return false;
    plan.state = "cancelled";
    saveTaskPlan(plan, plan.state, plan.correlationId);
    saveMemoryItem({ taskId, kind: "task_cancelled", content: { state: plan.state } });
    return true;
  }

  async resume(approvalId: number): Promise<ClosedLoopResult> {
    const approval = getApprovalRequest(approvalId);
    if (!approval) throw new Error("Approval not found");
    const plan = getTaskPlan(approval.task_id);
    if (!plan) throw new Error("Task not found");
    if (runningTasks.has(plan.id)) throw new Error("Task is already running");
    runningTasks.add(plan.id);
    try {
    const result = await resumeApprovedTask(approvalId, plan, this.dependencies.createExecutor(plan.correlationId ?? approval.correlation_id ?? crypto.randomUUID(), plan.id), this.dependencies.recoveryProvider);
    if (!result) throw new Error("Approval cannot resume this task");
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
    return {
      task: plan,
      status: timeline.finalStatus,
      completedSteps: plan.steps.filter((step) => step.status === "completed").length,
      failedSteps: plan.steps.filter((step) => step.status === "failed").length,
      timeline,
      reflection: analyzeTaskHistory(taskId),
      metrics: getAgentMetrics()
    };
  }
}
