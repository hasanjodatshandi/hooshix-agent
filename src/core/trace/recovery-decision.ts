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

  return {
    type: "stop",
    reason: finding.failedStep
      ? `step ${finding.failedStep} requires an explicit corrective plan from ChatGPT`
      : "unable to determine safe recovery"
  };
}
