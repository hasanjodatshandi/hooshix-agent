import { getTaskPlan, saveMemoryItem, listMemoryItems } from "../memory/task-repository.js";

export type ReconciliationFinding = "effect_observed" | "effect_not_observed" | "undetermined";

/**
 * Audit-only reconciliation of an interrupted operation. This must never
 * rewrite an outcome_unknown step, consume an approval, or replay a side effect.
 * The finding is an operator assertion supported by the cited evidence, not
 * proof that the interrupted tool call returned successfully.
 */
export function recordTaskReconciliation(input: {
  taskId: string;
  stepId: number;
  finding: ReconciliationFinding;
  evidence: string;
  verificationTaskId?: string;
}) {
  const plan = getTaskPlan(input.taskId);
  if (!plan) throw new Error("Task not found");
  const step = plan.steps.find((s) => s.id === input.stepId);
  if (!step || step.status !== "outcome_unknown") {
    throw new Error("Reconciliation is only allowed for a step currently in outcome_unknown");
  }
  if (plan.state !== "failed") throw new Error("Task must be terminal-failed before reconciliation");
  if (input.evidence.trim().length < 12) throw new Error("Reconciliation evidence must describe what was checked");
  if (input.verificationTaskId === input.taskId) throw new Error("Verification task must be separate from the interrupted task");
  if (input.finding === "effect_observed" && !input.verificationTaskId) {
    throw new Error("effect_observed requires a separate completed read-only verification task");
  }
  if (input.verificationTaskId) {
    const verification = getTaskPlan(input.verificationTaskId);
    const safeTools = new Set(["get_system_info", "agent_metrics", "list_directory", "read_file",
      "search_files", "git_status", "git_diff", "git_log", "get_workspace"]);
    if (!verification || verification.state !== "completed" ||
      verification.steps.length === 0 ||
      verification.steps.some((s) => s.status !== "completed" || !s.tool || !safeTools.has(s.tool))) {
      throw new Error("Verification task must exist, be completed, and contain only completed read-only steps");
    }
  }
  const record = {
    taskId: input.taskId,
    stepId: input.stepId,
    finding: input.finding,
    evidence: input.evidence.trim(),
    verificationTaskId: input.verificationTaskId ?? null,
    recordedAt: new Date().toISOString(),
    interruptedToolResult: "unknown",
    replayed: false,
  };
  const memoryId = saveMemoryItem({ taskId: input.taskId, kind: "outcome_reconciliation", content: record });
  return { memoryId, ...record, taskStatus: plan.state, stepStatus: step.status };
}

export function getTaskReconciliations(taskId: string) {
  return listMemoryItems({ taskId, kind: "outcome_reconciliation", limit: 100 }).items;
}
