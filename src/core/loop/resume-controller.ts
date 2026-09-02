import type { TaskPlan } from "../planner/task-planner.js";
import type { ResumeContext } from "./resume-engine.js";
import { restorePlanPosition } from "./plan-resume.js";

export function preparePlanForResume(plan: TaskPlan, context: ResumeContext) {
  return restorePlanPosition(plan, context);
}

export function getResumeStartIndex(context: ResumeContext) {
  return context.stepIndex;
}
