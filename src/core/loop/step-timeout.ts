/**
 * Step-level deadline resolution.
 *
 * execute_command accepts a `timeout` argument (capped at 120000ms by its
 * schema) that governs the subprocess itself. The Task loop applies its OWN
 * deadline on top, which used to default to 30000ms regardless of what the tool
 * was asked to honour — so a 55s build the caller requested 120s for was killed
 * at 30s and recorded as outcome_unknown. When the step does not declare its own
 * deadline, fall back to the tool's, plus a margin: the tool's own timeout fires
 * first and reports a clean timeout result with the captured output, and this
 * deadline stays a backstop that cancels a genuinely stuck invocation.
 */
export const DEFAULT_STEP_TIMEOUT_MS = 30_000;
export const COMMAND_TIMEOUT_CAP_MS = 120_000;
export const COMMAND_TIMEOUT_MARGIN_MS = 5_000;

export interface StepTimeoutInput {
  /** Explicit step-level deadline in ms (0 disables). */
  readonly timeout?: number;
  readonly tool?: string;
  readonly arguments?: Record<string, unknown> | null;
}

export function effectiveStepTimeout(step: StepTimeoutInput): number {
  if (typeof step.timeout === "number") return step.timeout;
  const requested = step.tool === "execute_command"
    && typeof step.arguments?.timeout === "number" && step.arguments.timeout > 0
    ? Math.min(step.arguments.timeout, COMMAND_TIMEOUT_CAP_MS)
    : undefined;
  return requested !== undefined ? requested + COMMAND_TIMEOUT_MARGIN_MS : DEFAULT_STEP_TIMEOUT_MS;
}
