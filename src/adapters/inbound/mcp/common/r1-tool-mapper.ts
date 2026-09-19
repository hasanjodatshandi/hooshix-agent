import type { Principal } from "../../../../domain/auth/principal.js";
import type { ToolId } from "../../../../domain/shared/ids.js";
import type { WorkspaceScope } from "../../../../domain/workspace/workspace-scope.js";
import type { ExecuteToolUseCase, ToolExecutionResult } from "../../../../application/use-cases/tools/execute-tool.usecase.js";
/** R1 shape-only inbound adapter: no MCP SDK, file I/O, or service bypass. R2 replaces registration/wiring. */
export interface R1InboundToolRequest {
 readonly principal: Principal; readonly toolId: ToolId; readonly arguments: unknown; readonly scope: WorkspaceScope;
}
export function createR1InboundToolMapper(useCase: ExecuteToolUseCase): { execute(input: R1InboundToolRequest): Promise<ToolExecutionResult> } {
 return { execute({principal,toolId,arguments:args,scope}) {
   return useCase.execute({principal,descriptorId:toolId,arguments:args,scope});
 } };
}
