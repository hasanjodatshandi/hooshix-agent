import type { TaskStep } from "../planner/task-planner.js";
import { policyDecisionPoint } from "./policy-decision-point.js";
import { selectTool } from "../orchestrator/tool-orchestrator.js";
import { evaluateAction } from "./governance-engine.js";

/**
 * Classify a step's policy posture BEFORE execution. For execute_command, an
 * explicit cwd outside the active workspace is derived inside the PDP; an
 * omitted/`.` cwd is resolved here against the task's persisted workspace so
 * governance sees the EFFECTIVE cwd the handler will use (executionContext.
 * workspace) — never the server process cwd.
 */
export function checkStepGovernance(step: TaskStep | string, effectiveCwd?: string) {
  if (typeof step === "string") return evaluateAction(step);

  const tool = selectTool(step);
  const args = { ...(step.arguments ?? {}) } as Record<string, unknown>;
  if (tool === "execute_command" && effectiveCwd) {
    const raw = args.cwd;
    if (typeof raw !== "string" || raw.length === 0 || raw === ".") args.cwd = effectiveCwd;
  }
  const result = policyDecisionPoint.evaluate({ tool, arguments: args });
  return {
    decision: !result.allowed ? "blocked" as const : result.requiresApproval ? "approval_required" as const : "allow" as const,
    risk: result.risk,
    reason: result.reason
  };
}
