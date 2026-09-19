import { assertTaskInvariants, type Task, type TaskStep } from "../../../domain/task/task.js";
import { captureWorkspaceScope } from "../../../domain/workspace/workspace-scope.js";
import type { PrincipalId, SessionId } from "../../../domain/shared/ids.js";
import type { TaskRepository } from "../../ports/outbound/task-repository.port.js";
import type { ClockPort, IdGeneratorPort, WorkspaceContextRepository } from "../../ports/outbound/support.port.js";
export interface CreateTaskUseCase { execute(input: {
 readonly principalId: PrincipalId; readonly sessionId: SessionId; readonly title: string; readonly steps: readonly TaskStep[];
}): Promise<Task>; }
export function createCreateTaskUseCase(deps: {
 readonly tasks: TaskRepository; readonly workspace: WorkspaceContextRepository;
 readonly clock: ClockPort; readonly ids: IdGeneratorPort;
}): CreateTaskUseCase {
 return { async execute({ principalId, sessionId, title, steps }) {
   const scope = await deps.workspace.get(sessionId, principalId);
   if (!scope) throw new Error("workspace_context_required");
   const now = deps.clock.now();
   const task: Task = {
     id: deps.ids.nextTaskId(), correlationId: deps.ids.nextCorrelationId(), title, state: "planning",
     steps: steps.map(s => ({ ...s, dependencies: [...s.dependencies], attemptHistory: [...s.attemptHistory] })),
     executionScope: captureWorkspaceScope(scope), retryPolicy: { maxAttempts: 1 },
     totalRunCount: 0, createdAt: now, updatedAt: now,
   };
   assertTaskInvariants(task);
   await deps.tasks.create(task);
   return task;
 } };
}
