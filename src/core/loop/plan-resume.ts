import type { TaskPlan } from "../planner/task-planner.js";
import type { ResumeContext } from "./resume-engine.js";

/**
 * Prepare the plan for resume: only the approved step is reset to "pending".
 * Steps before it keep their true persisted status — force-marking them
 * "completed" (the old behavior) falsified history and made downstream
 * {{stepN.*}} templates fail with MissingVariableError for steps that
 * legitimately failed or were skipped.
 */
export function restorePlanPosition(plan: TaskPlan, context: ResumeContext) {
  plan.steps = plan.steps.map((step, index) => {
    if (index === context.stepIndex) {
      return { ...step, status: "pending" as const };
    }
    return step;
  });

  return plan;
}
