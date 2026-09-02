import type { TaskPlan, TaskStep } from "../planner/task-planner.js";

export function getPendingResumeSteps(plan: TaskPlan): TaskStep[] {
  return plan.steps.filter((step) => step.status !== "completed");
}

export function markResumeCompleted(plan: TaskPlan, index: number) {
  plan.steps = plan.steps.map((step, stepIndex) =>
    stepIndex === index ? { ...step, status: "completed" } : step
  );

  return plan;
}
