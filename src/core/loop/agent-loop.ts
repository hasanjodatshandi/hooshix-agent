import type { TaskPlan, TaskStep } from "../planner/task-planner.js";
import { runClosedAgentLoop } from "./closed-agent-loop.js";

export type AgentLoopStatus = "running" | "completed" | "failed";

export interface AgentLoopResult {
  status: AgentLoopStatus;
  completedSteps: TaskStep[];
  failedStep?: TaskStep;
}

/** @deprecated Use runClosedAgentLoop; retained as a compatibility adapter. */
export async function runAgentLoop(
  plan: TaskPlan,
  toolExecutor: (tool: string, step: TaskStep) => Promise<unknown>
): Promise<AgentLoopResult> {
  const result = await runClosedAgentLoop(plan, toolExecutor, 0);
  return result.status === "completed"
    ? { status: "completed", completedSteps: result.completedSteps }
    : { status: "failed", completedSteps: result.completedSteps, failedStep: plan.steps.find((step) => step.status === "failed" || step.status === "blocked") };
}
