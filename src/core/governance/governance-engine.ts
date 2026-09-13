export type ActionRisk = "low" | "medium" | "high" | "critical";
export type GovernanceDecision = "allow" | "approval_required" | "blocked";

export interface GovernanceResult {
  decision: GovernanceDecision;
  risk: ActionRisk;
  reason: string;
}

export function evaluateAction(action: string): GovernanceResult {
  const value = action.toLowerCase();

  if (value.includes("delete") || value.includes("remove")) {
    return {
      decision: "approval_required",
      risk: "high",
      reason: "destructive filesystem action"
    };
  }

  if (value.includes("install") || value.includes("uninstall") || value.includes("admin")) {
    return {
      decision: "approval_required",
      risk: "critical",
      reason: "system level operation"
    };
  }

  return {
    decision: "allow",
    risk: "low",
    reason: "normal development operation"
  };
}

export function assertGovernance(action: string) {
  return evaluateAction(action);
}
