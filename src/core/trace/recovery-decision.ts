import type { DebugFinding } from "./failure-analyzer.js";
import type { RecoveryAction } from "../recovery/recovery-engine.js";
import { classifyError } from "../errors.js";

/**
 * Choose a recovery strategy for a failed step. Decisions are driven by the
 * typed error taxonomy (classifyError) with the legacy message analysis as
 * a secondary signal — the old substring-only matcher misclassified every
 * timeout as a hard stop because "timed out" didn't contain "timeout".
 */
export function createRecoveryDecision(finding: DebugFinding): RecoveryAction {
  const reason = finding.reason;

  switch (classifyError(reason)) {
    case "MISSING_CONTEXT_VARIABLE":
      return {
        type: "stop",
        reason: "Missing context variable; previous step output may not have been captured correctly"
      };
    case "SECURITY_POLICY":
      return {
        type: "stop",
        reason: "Security policy violation; this operation is not allowed"
      };
    case "TIMEOUT":
      return { type: "retry", reason: "transient timeout detected" };
    case "NETWORK":
      return { type: "retry", reason: "transient network failure detected" };
    case "APPROVAL_REQUIRED":
      return { type: "ask_approval", reason: "operation needs explicit approval" };
    case "UNKNOWN_TOOL":
      return { type: "change_tool", reason: "selected tool is unavailable; ChatGPT must select a valid tool" };
    case "FILE_NOT_FOUND":
      return { type: "stop", reason: "Required file does not exist; check path or create file first" };
    case "INVALID_ARGUMENT":
      return { type: "modify_input", reason: "tool input must be corrected before retry" };
    default:
      break;
  }

  // Secondary signal on the human-readable reason for findings that do not
  // carry a thrown error (analyzed from the trace).
  const normalized = reason.toLowerCase();
  if (normalized.includes("rollback")) {
    return { type: "rollback", reason: "rollback is required before execution can continue" };
  }
  if (normalized.includes("build") || normalized.includes("test") || normalized.includes("verification")) {
    return { type: "replan", reason: "verification failed; ChatGPT must provide a corrective plan" };
  }

  return {
    type: "stop",
    reason: finding.failedStep
      ? `step ${finding.failedStep} requires an explicit corrective plan from ChatGPT`
      : "unable to determine safe recovery"
  };
}
