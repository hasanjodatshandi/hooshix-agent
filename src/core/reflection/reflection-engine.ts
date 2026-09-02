import { saveMemory, loadMemory } from "../memory/agent-memory.js";
import type { TaskStep } from "../planner/task-planner.js";

export type ReflectionResult = "continue" | "recover";

export async function recordStepExecution(step: TaskStep, result: unknown) {
  const memory = (await loadMemory()) ?? {};

  const executions = Array.isArray(memory.executions)
    ? memory.executions
    : [];

  executions.push({
    step,
    result,
    timestamp: new Date().toISOString()
  });

  await saveMemory({
    ...memory,
    executions
  });
}

export function reflectOnStep(success: boolean): ReflectionResult {
  return success ? "continue" : "recover";
}
