import type { TaskPlan } from "../planner/task-planner.js";
import type { ResumeContext } from "./resume-engine.js";

export function restorePlanPosition(plan: TaskPlan, context: ResumeContext) {
  plan.steps = plan.steps.map((step, index) => {
    if (index < context.stepIndex) {
      return { ...step, status: "completed" };
    }

    if (index === context.stepIndex) {
      return { ...step, status: "pending" };
    }

    return step;
  });

  return plan;
}
