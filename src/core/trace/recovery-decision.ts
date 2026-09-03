import type { DebugFinding } from "./failure-analyzer.js";
import type { RecoveryAction } from "../recovery/recovery-engine.js";

export function createRecoveryDecision(finding: DebugFinding): RecoveryAction {
  const reason = finding.reason.toLowerCase();

  if (reason.includes("timeout") || reason.includes("network")) {
    return {
      type: "retry",
      reason: "transient failure detected"
    };
  }

  if (reason.includes("approval") || reason.includes("permission")) {
    return { type: "ask_approval", reason: "operation needs explicit approval" };
  }
  if (reason.includes("unknown tool") || reason.includes("unsupported task tool")) {
    return { type: "change_tool", reason: "selected tool is unavailable; ChatGPT must select a valid tool" };
  }
  if (reason.includes("invalid") || reason.includes("schema") || reason.includes("argument")) {
    return { type: "modify_input", reason: "tool input must be corrected before retry" };
  }
  if (reason.includes("rollback")) {
    return { type: "rollback", reason: "rollback is required before execution can continue" };
  }
  if (reason.includes("build") || reason.includes("test") || reason.includes("verification")) {
    return { type: "replan", reason: "verification failed; ChatGPT must provide a corrective plan" };
  }

  return {
    type: "stop",
    reason: finding.failedStep
      ? `step ${finding.failedStep} requires an explicit corrective plan from ChatGPT`
      : "unable to determine safe recovery"
  };
}
