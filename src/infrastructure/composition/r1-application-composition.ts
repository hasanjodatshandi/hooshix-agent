import { createMemoryTaskRepository } from "../../adapters/outbound/in-memory/memory-task-repository.adapter.js";
import { createMemoryWorkspaceContextRepository } from "../../adapters/outbound/in-memory/memory-workspace-context.adapter.js";
import { createFakeReadOnlyToolAdapters } from "../../adapters/outbound/in-memory/r1-fake-tool-adapters.js";
import { createCreateTaskUseCase } from "../../application/use-cases/tasks/create-task.usecase.js";
import { createGetTaskUseCase } from "../../application/use-cases/tasks/get-task.usecase.js";
import { createGetWorkspaceUseCase } from "../../application/use-cases/workspace/get-workspace.usecase.js";
import { createExecuteToolUseCase } from "../../application/use-cases/tools/execute-tool.usecase.js";
import { createR1AuthorizationService } from "../../application/services/authorization-service.js";
import type { ClockPort, IdGeneratorPort } from "../../application/ports/outbound/support.port.js";
import type { ToolDescriptor } from "../../domain/tool/tool-descriptor.js";
import type { TaskId, ExecutionId, CorrelationId } from "../../domain/shared/ids.js";
/** R1 bootstrap used only in isolated tests: NOT wired into live MCP/Task adapters until R2. */
export function createR1FakeComposition(input: { readonly descriptor: ToolDescriptor; readonly output: unknown; readonly clock: ClockPort; readonly ids: IdGeneratorPort }) {
 const tasks=createMemoryTaskRepository();
 const workspace=createMemoryWorkspaceContextRepository();
 const tools=createFakeReadOnlyToolAdapters(input.descriptor,input.output);
 return {
   tasks, workspace, tools,
   createTask:createCreateTaskUseCase({tasks,workspace,clock:input.clock,ids:input.ids}),
   getTask:createGetTaskUseCase(tasks),
   getWorkspace:createGetWorkspaceUseCase(workspace),
   executeTool:createExecuteToolUseCase({...tools,authorization:createR1AuthorizationService()}),
 };
}
/** Explicit adapter construction; no service locator and no process/env/global IO. */
export function createR1DeterministicIds(): IdGeneratorPort {
 let n=0;
 return {
   nextTaskId:()=>("r1-task-"+(++n)) as TaskId,
   nextExecutionId:()=>("r1-exec-"+(++n)) as ExecutionId,
   nextCorrelationId:()=>("r1-correlation-"+(++n)) as CorrelationId,
 };
}
