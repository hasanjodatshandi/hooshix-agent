import { validateToolArguments, validateToolName, type ToolName } from "../orchestrator/tool-orchestrator.js";
import type { TaskState } from "../state/task-state-machine.js";

export type TaskStepStatus = "pending" | "running" | "completed" | "failed" | "pending_approval" | "blocked";

export interface TaskStep {
  id: number;
  action: string;
  status: TaskStepStatus;
  tool?: ToolName;
  arguments?: Record<string, unknown>;
  dependsOn?: number[];
  output?: unknown;
  error?: string;
}

export interface TaskPlan {
  id: string;
  task: string;
  description?: string;
  correlationId?: string;
  state?: TaskState;
  steps: TaskStep[];
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
