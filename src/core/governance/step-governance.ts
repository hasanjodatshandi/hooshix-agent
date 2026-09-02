import { evaluateAction } from "../governance/governance-engine.js";
import type { TaskStep } from "../planner/task-planner.js";

export function checkStepGovernance(step: TaskStep | string) {
  if (typeof step === "string") return evaluateAction(step);

  if (step.tool === "delete_file") {
    return { decision: "approval_required" as const, risk: "high" as const, reason: "destructive filesystem action" };
  }
  if (step.tool === "install_package" || step.tool === "remove_package" || step.tool === "update_package") {
    return { decision: "approval_required" as const, risk: "critical" as const, reason: "package management operation" };
  }
  if (step.tool) {
    return { decision: "allow" as const, risk: "low" as const, reason: "typed tool policy allows this operation" };
  }
  return evaluateAction(step.action);
}
