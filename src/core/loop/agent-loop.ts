import type { TaskPlan, TaskStep } from "../planner/task-planner.js";
import { executeToolStep } from "../orchestrator/tool-orchestrator.js";

export type AgentLoopStatus = "running" | "completed" | "failed";

export interface AgentLoopResult {
  status: AgentLoopStatus;
  completedSteps: TaskStep[];
  failedStep?: TaskStep;
}

export async function runAgentLoop(
  plan: TaskPlan,
  toolExecutor: (tool: string, step: TaskStep) => Promise<unknown>
): Promise<AgentLoopResult> {
  const completedSteps: TaskStep[] = [];

  for (const step of plan.steps) {
    step.status = "running";

    try {
      await executeToolStep(step, toolExecutor);
      step.status = "completed";
      completedSteps.push(step);
    } catch {
      step.status = "failed";
      return {
        status: "failed",
        completedSteps,
        failedStep: step
      };
    }
  }

  return {
    status: "completed",
    completedSteps
  };
}
