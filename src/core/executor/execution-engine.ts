import type { TaskPlan, TaskStep } from "../planner/task-planner.js";
import { transitionTask, type TaskState } from "../state/task-state-machine.js";

export interface ExecutionResult {
  step: TaskStep;
  state: TaskState;
}

export async function executePlan(
  plan: TaskPlan,
  initialState: TaskState = "created",
  runner: (step: TaskStep) => Promise<void>
): Promise<ExecutionResult[]> {
  const results: ExecutionResult[] = [];
  let state = transitionTask(initialState, "planning");
  state = transitionTask(state, "executing");

  for (const step of plan.steps) {
    step.status = "running";

    try {
      await runner(step);
      step.status = "completed";
      results.push({ step, state });
    } catch {
      step.status = "failed";
      throw new Error(`Step failed: ${step.action}`);
    }
  }

  state = transitionTask(state, "verifying");
  state = transitionTask(state, "completed");

  return results.map((item) => ({ ...item, state }));
}
