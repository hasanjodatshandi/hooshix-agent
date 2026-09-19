import type { TaskPlan } from "../planner/task-planner.js";

export interface RecoveryMetricsResult {
  recoveryAttempts: number;
  successfulRecoveries: number;
  failedRecoveries: number;
  recoverySuccessRate: number | null;
}

export interface TimelineEventLike {
  type: string;
  data?: unknown;
}

/**
 * Compute recovery metrics from the in-memory task plan and timeline events.
 * This is the single source of truth for recovery accounting (OBS-01/OBS-02).
 *
 * A recovery is only "successful" if the step it was targeting eventually
 * completed. outcome="retrying" just means the retry was scheduled — it
 * doesn't mean the recovery succeeded.
 */
export function computeRecoveryMetrics(
  plan: TaskPlan,
  timelineEvents: TimelineEventLike[]
): RecoveryMetricsResult {
  // Recovery attempt info is saved via saveExecutionWithContext with
  // result.type === "recovery_attempt" nested inside the execution event.
  const recoveryEvents = timelineEvents.filter((e) => {
    const d = e.data as Record<string, unknown> | undefined;
    const resultObj = d?.result as Record<string, unknown> | undefined;
    return (
      (d?.type === "recovery_attempt" || resultObj?.type === "recovery_attempt") &&
      typeof (d?.stepId ?? resultObj?.stepId) === "number"
    );
  });

  const recoveryAttemptCount = recoveryEvents.length;

  // A recovery is only "successful" if the step it was targeting
  // eventually completed.
  const successfulRecoveryCount = recoveryEvents.filter((e) => {
    const d = e.data as Record<string, unknown>;
    const resultObj = d?.result as Record<string, unknown> | undefined;
    const stepId = (d?.stepId ?? resultObj?.stepId) as number | undefined;
    if (stepId === undefined) return false;
    const step = plan.steps.find((s: { id: number }) => s.id === stepId);
    return step && step.status === "completed";
  }).length;

  const failedRecoveryCount = recoveryAttemptCount - successfulRecoveryCount;

  return {
    recoveryAttempts: recoveryAttemptCount,
    successfulRecoveries: successfulRecoveryCount,
    failedRecoveries: failedRecoveryCount,
    recoverySuccessRate:
      recoveryAttemptCount === 0 ? null : successfulRecoveryCount / recoveryAttemptCount,
  };
}
