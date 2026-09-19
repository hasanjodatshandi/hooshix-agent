import type { ApprovalId, StepId, TaskId } from "../../../domain/shared/ids.js";
import type { Task, TaskStep } from "../../../domain/task/task.js";
/** R1 inbound contracts only: implemented against durable adapters in R3, not fake success shims. */
export interface RunTaskUseCase { execute(id: TaskId): Promise<Task>; }
export interface ResumeTaskUseCase { execute(approvalId: ApprovalId): Promise<Task>; }
export interface ApproveTaskUseCase { execute(id: ApprovalId): Promise<boolean>; }
export interface CancelTaskUseCase { execute(id: TaskId): Promise<Task>; }
export interface AppendTaskStepsUseCase { execute(id: TaskId, steps: readonly TaskStep[]): Promise<Task>; }
export interface ReconcileStepOutcomeUseCase { execute(id: TaskId, stepId: StepId, evidence: string): Promise<Task>; }
export interface GetTaskReportUseCase { execute(id: TaskId): Promise<unknown>; }
