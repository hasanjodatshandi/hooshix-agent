import { validateToolArguments, validateToolName, type ToolName } from "../orchestrator/tool-orchestrator.js";
import type { TaskState } from "../state/task-state-machine.js";

export type TaskStepStatus = "pending" | "running" | "completed" | "failed" | "pending_approval" | "blocked" | "cancelled" | "outcome_unknown";

/** When should this step execute relative to its dependencies? */
export type StepRunCondition = "success" | "failure" | "always";

export interface StepAttempt {
  attempt: number;
  status: "failed" | "completed" | "cancelled";
  error?: string;
  timestamp: string;
}

export interface TaskStep {
  id: number;
  action: string;
  status: TaskStepStatus;
  tool?: ToolName;
  arguments?: Record<string, unknown>;
  dependsOn?: number[];
  /** When to run this step relative to its dependencies. Default: "success" (only if all deps succeeded). */
  runWhen?: StepRunCondition;
  output?: unknown;
  error?: string;
  errorType?: string;
  /** Step-level timeout in milliseconds. Default: 30000 (30s). Set 0 to disable. */
  timeout?: number;
  /** Total number of execution attempts for this step */
  attempts?: number;
  /** Number of failed attempts */
  failedAttempts?: number;
  /** Detailed attempt history */
  attemptHistory?: StepAttempt[];
  /** Immutable original template arguments (never overwritten by resolution) */
  templateArguments?: Record<string, unknown>;
}

export interface TaskExecutionContext {
  workspace: string;
  roots: string[];
  unrestricted: boolean;
}

export interface RetryPolicy {
  /** Max total task_run invocations across all runs */
  maxTotalAttempts?: number;
  /** Max consecutive failures before the task is considered stalled */
  maxConsecutiveFailures?: number;
}

export interface TaskPlan {
  id: string;
  task: string;
  description?: string;
  correlationId?: string;
  /** Client-supplied key for retry-safe deduplication. Same key + same payload → return existing task. */
  idempotencyKey?: string;
  state?: TaskState;
  steps: TaskStep[];
  executionContext?: TaskExecutionContext;
  maxRecovery?: number;
  /** Plan revision counter — incremented when steps are appended */
  revision?: number;
  /** Cumulative retry policy across task_run invocations */
  retryPolicy?: RetryPolicy;
  /** Total number of task_run invocations for this task */
  totalRunCount?: number;
  pendingApproval?: {
    approvalId: number;
    stepId: number;
    action: string;
    risk: string;
    reason: string;
  };
}

export interface TemplateValidationError {
  stepId: number;
  argumentPath: string;
  template: string;
  reason: "unknown_step_reference" | "self_reference" | "future_step_reference";
}

/**
 * Extract all template references from a value (string, array, object).
 * Returns array of [refPath, fullTemplateToken].
 */
function extractTemplateRefs(value: unknown, path = ""): Array<{ refPath: string; fullToken: string; argPath: string }> {
  const results: Array<{ refPath: string; fullToken: string; argPath: string }> = [];
  if (typeof value === "string") {
    // Match: {{stepN.output.field}}, {{stepN.status}}, {{stepN.error}}, {{helper(stepN.output.field)}}
    // Two alternatives: helper(...stepN...) or stepN...
    const helperRegex = /\{\{(string|number|boolean|json)\((step\d+(?:\.[a-zA-Z0-9_[\]]+)*)\)\}\}/g;
    const directRegex = /\{\{(step\d+(?:\.(?:output|status|error)(?:\.[a-zA-Z0-9_[\]]+)*)?)\}\}/g;
    let match;
    while ((match = helperRegex.exec(value)) !== null) {
      results.push({ refPath: match[2], fullToken: match[0], argPath: path });
    }
    while ((match = directRegex.exec(value)) !== null) {
      results.push({ refPath: match[1], fullToken: match[0], argPath: path });
    }
    return results;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      results.push(...extractTemplateRefs(value[i], `${path}[${i}]`));
    }
    return results;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      results.push(...extractTemplateRefs(val, path ? `${path}.${key}` : key));
    }
    return results;
  }
  return results;
}

/**
 * Validate that template references in step arguments are statically valid.
 * Rejects: unknown step references, self references, future step references.
 */
export function validateTemplateReferences(plan: TaskPlan): TemplateValidationError[] {
  const errors: TemplateValidationError[] = [];
  const stepIds = new Set(plan.steps.map((s) => s.id));
  // Build an ordered map for future-reference detection
  const stepOrder = new Map<number, number>();
  plan.steps.forEach((s, i) => stepOrder.set(s.id, i));

  for (const step of plan.steps) {
    const args = step.arguments ?? {};
    const refs = extractTemplateRefs(args);
    for (const ref of refs) {
      const refStepId = parseInt(ref.refPath.replace("step", ""), 10);
      // Unknown step
      if (!stepIds.has(refStepId)) {
        errors.push({
          stepId: step.id,
          argumentPath: ref.argPath,
          template: ref.fullToken,
          reason: "unknown_step_reference",
        });
        continue;
      }
      // Self reference
      if (refStepId === step.id) {
        errors.push({
          stepId: step.id,
          argumentPath: ref.argPath,
          template: ref.fullToken,
          reason: "self_reference",
        });
        continue;
      }
      // Future reference — referenced step comes after consumer in execution order
      const consumerOrder = stepOrder.get(step.id) ?? -1;
      const producerOrder = stepOrder.get(refStepId) ?? -1;
      if (producerOrder > consumerOrder) {
        errors.push({
          stepId: step.id,
          argumentPath: ref.argPath,
          template: ref.fullToken,
          reason: "future_step_reference",
        });
      }
    }
  }
  return errors;
}

export function validateTaskPlan(plan: TaskPlan): TaskPlan {
  if (!plan.task.trim()) throw new Error("Task title must not be empty");
  if (plan.steps.length === 0) throw new Error("Task must contain at least one step");
  const seen = new Set<number>();
  for (const [index, step] of plan.steps.entries()) {
    if (seen.has(step.id)) throw new Error(`Duplicate step id: ${step.id}`);
    step.dependsOn ??= index > 0 ? [plan.steps[index - 1].id] : [];
    for (const dependency of step.dependsOn) {
      if (dependency === step.id) throw new Error(`Step ${step.id} cannot depend on itself`);
      if (!seen.has(dependency)) throw new Error(`Step ${step.id} depends on missing or later step ${dependency}`);
    }
    if (step.tool) {
      step.tool = validateToolName(step.tool);
      step.arguments = validateToolArguments(step.tool, step.arguments ?? {});
    }
    step.status ??= "pending";
    seen.add(step.id);
  }
  // Validate template references are statically resolvable
  const templateErrors = validateTemplateReferences(plan);
  if (templateErrors.length > 0) {
    const summary = templateErrors.map((e) => `${e.reason}: ${e.template} in step ${e.stepId} (${e.argumentPath})`).join("; ");
    throw new Error(`Invalid template references: ${summary}`);
  }
  return plan;
}

export function createTaskPlan(task: string, steps?: Array<Omit<TaskStep, "id" | "status"> & Partial<Pick<TaskStep, "id" | "status">>>, description?: string): TaskPlan {
  return validateTaskPlan({
    id: crypto.randomUUID(),
    task,
    description,
    state: "created",
    steps: steps?.map((step, index) => ({
      ...step,
      id: step.id ?? index + 1,
      status: step.status ?? "pending"
    })) ?? [
      { id: 1, action: "inspect project", tool: "list_directory", arguments: { path: "." }, status: "pending" },
      { id: 2, action: "inspect implementation markers", tool: "search_files", arguments: { path: ".", query: "TODO" }, status: "pending" },
      { id: 3, action: "verify runtime", tool: "execute_command", arguments: { command: "node", args: ["--version"] }, status: "pending" }
    ]
  });
}
