import type { TaskStep } from "../planner/task-planner.js";
import { policyDecisionPoint } from "./policy-decision-point.js";
import { selectTool } from "../orchestrator/tool-orchestrator.js";
import { evaluateAction } from "./governance-engine.js";

export function checkStepGovernance(step: TaskStep | string) {
  if (typeof step === "string") return evaluateAction(step);

  const result = policyDecisionPoint.evaluate({ tool: selectTool(step), arguments: step.arguments });
  return {
    decision: !result.allowed ? "blocked" as const : result.requiresApproval ? "approval_required" as const : "allow" as const,
    risk: result.risk,
    reason: result.reason
  };
}
