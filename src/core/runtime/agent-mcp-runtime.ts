import { createExecutionContext } from "./execution-context.js";
import { createStdioMcpInvoker } from "../mcp/stdio-client-bridge.js";
import { createMcpToolExecutor } from "../orchestrator/mcp-tool-executor.js";
import type { TaskPlan } from "../planner/task-planner.js";
import { runClosedAgentLoop } from "../loop/closed-agent-loop.js";
import { createRuntimeDependencies } from "./composition-root.js";

export async function createAgentMcpRuntime(command: string, args: string[] = []) {
  const invoker = await createStdioMcpInvoker(command, args);
  const context = createExecutionContext();

  const executor = createMcpToolExecutor(invoker, context);
  const dependencies = createRuntimeDependencies();
  return {
    context,
    executor,
    run(plan: TaskPlan, maxRecovery = 1) {
      context.taskId = plan.id;
      return runClosedAgentLoop(plan, executor, maxRecovery, 0, context, dependencies.recoveryProvider);
    },
    close: invoker.close
  };
}
