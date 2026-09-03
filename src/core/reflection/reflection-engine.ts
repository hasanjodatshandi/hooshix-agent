import { saveMemory, loadMemory } from "../memory/agent-memory.js";
import type { TaskStep } from "../planner/task-planner.js";
import { withAgentDatabase } from "../memory/database.js";

export type ReflectionResult = "continue" | "recover";

export interface ReflectionReport {
  problem: string;
  cause: string;
  solution: string;
  confidence: number;
  futureRecommendation: string;
}

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

function executionError(result: unknown): string | undefined {
  if (typeof result !== "string") return undefined;
  try {
    const parsed = JSON.parse(result) as { error?: unknown };
    return typeof parsed.error === "string" ? parsed.error : undefined;
  } catch {
    return undefined;
  }
}

export function analyzeTaskHistory(taskId: string): ReflectionReport {
  return withAgentDatabase((db) => {
    const rows = db.prepare("SELECT action, result, status FROM executions WHERE task_id = ? ORDER BY id")
      .all(taskId) as Array<{ action: string; result: string | null; status: string }>;
    const failures = rows.filter((row) => row.status === "failed");
    const successes = rows.filter((row) => row.status === "completed");
    const latestFailure = failures.at(-1);
    const recovered = latestFailure ? rows.slice(rows.indexOf(latestFailure) + 1).some((row) => row.status === "completed") : false;
    return {
      problem: latestFailure?.action ?? "No execution failure recorded",
      cause: executionError(latestFailure?.result) ?? (latestFailure ? "Tool execution failed" : "No failure detected"),
      solution: recovered ? successes.at(-1)?.action ?? "A later step succeeded" : failures.length ? "No verified solution yet" : "Existing execution path succeeded",
      confidence: rows.length === 0 ? 0 : failures.length === 0 ? 1 : recovered ? 0.8 : 0.4,
      futureRecommendation: failures.length === 0
        ? "Reuse the explicit tool plan and keep current governance checks"
        : recovered
          ? "Prefer the successful follow-up action when the same failure pattern appears"
          : "Ask ChatGPT for an explicit corrective plan before retrying"
    };
  });
}
