/** R1 compatibility facade; DTO/validation moved inward, ID generation moved to infrastructure. */
export { validateTemplateReferences, validateTaskPlan } from "../../application/services/legacy-task-plan-validator.js";
export { createTaskPlan } from "../../infrastructure/composition/legacy-task-plan-factory.js";
export type {
  TaskStepStatus,
  StepRunCondition,
  StepAttempt,
  TaskStep,
  TaskExecutionContext,
  RetryPolicy,
  TaskPlan,
  TemplateValidationError,
} from "../../application/dto/legacy-task-plan.js";
