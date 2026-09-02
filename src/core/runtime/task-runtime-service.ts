import { approveRequest, getApprovalRequest } from "../governance/approval-memory.js";
import { createLocalToolExecutor } from "../executor/local-tool-executor.js";
import { runClosedAgentLoop, type ClosedLoopResult } from "../loop/closed-agent-loop.js";
import { resumeApprovedTask } from "../loop/resume-orchestrator.js";
import { getTaskPlan, listTasks, saveMemoryItem, saveTaskPlan } from "../memory/task-repository.js";
import { createTaskPlan, type TaskStep, validateTaskPlan } from "../planner/task-planner.js";
import { createExecutionContext } from "./execution-context.js";
import { UnifiedTimelineService } from "../trace/unified-timeline-service.js";
import { SqliteTraceRepository } from "../trace/trace-repository.js";
import { PersistentRecoveryRepository } from "../trace/recovery-repository.js";

export class TaskRuntimeService {
  private readonly running = new Set<string>();

  create(input: { title: string; description?: string; steps: Array<Omit<TaskStep, "id" | "status"> & Partial<Pick<TaskStep, "id" | "status">>>; correlationId?: string }) {
    const serialized = JSON.stringify(input);
    if (Buffer.byteLength(serialized, "utf8") > 8 * 1024 * 1024) throw new Error("Task plan exceeds the 8 MiB limit");
    const plan = createTaskPlan(input.title, input.steps, input.description);
    plan.correlationId = input.correlationId ?? crypto.randomUUID();
    saveTaskPlan(plan, "planned", plan.correlationId);
    saveMemoryItem({ taskId: plan.id, kind: "task_created", content: { title: plan.task, steps: plan.steps.length } });
    return plan;
  }

  get(taskId: string) { return getTaskPlan(taskId); }
  list(limit?: number) { return listTasks(limit); }

  async run(taskId: string, maxRecovery = 1): Promise<ClosedLoopResult> {
    if (this.running.has(taskId)) throw new Error("Task is already running");
    this.running.add(taskId);
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
    const result = await runClosedAgentLoop(plan, createLocalToolExecutor(context.correlationId, taskId), maxRecovery, startIndex, context);
    saveTaskPlan(plan, result.status === "pending_approval" ? "paused" : result.status, context.correlationId);
    saveMemoryItem({ taskId, kind: "task_run", content: { status: result.status, completedSteps: result.completedSteps.map((step) => step.id) } });
    return result;
    } finally {
      this.running.delete(taskId);
    }
  }

  approve(approvalId: number): boolean { return approveRequest(approvalId); }

  async resume(approvalId: number): Promise<ClosedLoopResult> {
    const approval = getApprovalRequest(approvalId);
    if (!approval) throw new Error("Approval not found");
    const plan = getTaskPlan(approval.task_id);
    if (!plan) throw new Error("Task not found");
    if (this.running.has(plan.id)) throw new Error("Task is already running");
    this.running.add(plan.id);
    try {
    const result = await resumeApprovedTask(approvalId, plan, createLocalToolExecutor(plan.correlationId ?? approval.correlation_id ?? crypto.randomUUID(), plan.id));
    if (!result) throw new Error("Approval cannot resume this task");
    saveTaskPlan(plan, result.status === "pending_approval" ? "paused" : result.status, result.correlationId);
    return result;
    } finally {
      this.running.delete(plan.id);
    }
  }

  report(taskId: string) {
    const plan = getTaskPlan(taskId);
    if (!plan) throw new Error("Task not found");
    const correlationId = plan.correlationId;
    if (!correlationId) throw new Error("Task has no correlation ID");
    const timeline = new UnifiedTimelineService(new SqliteTraceRepository(), new PersistentRecoveryRepository()).build(correlationId);
    return {
      task: plan,
      status: timeline.finalStatus,
      completedSteps: plan.steps.filter((step) => step.status === "completed").length,
      failedSteps: plan.steps.filter((step) => step.status === "failed").length,
      timeline
    };
  }
}
