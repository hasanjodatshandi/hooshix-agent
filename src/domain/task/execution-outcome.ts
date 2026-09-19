import type { ExecutionId, StepId, ToolId } from "../shared/ids.js";
import type { ToolEffect } from "../tool/tool-descriptor.js";
export type StepOutcome =
  | { readonly kind: "succeeded"; readonly output: unknown }
  | { readonly kind: "failed_known"; readonly reason: string }
  | { readonly kind: "blocked"; readonly reason: string }
  | { readonly kind: "approval_required"; readonly approvalRequestId: string }
  | { readonly kind: "outcome_unknown"; readonly reason: string }
  | { readonly kind: "reconciled_succeeded"; readonly evidence: string }
  | { readonly kind: "reconciled_failed"; readonly evidence: string };
export type ReconciliationState = "not_required" | "unresolved" | "effect_observed" | "effect_not_observed" | "reconciled_succeeded" | "reconciled_failed";
export interface ExecutionReceipt {
  readonly executionId: ExecutionId;
  readonly stepId: StepId;
  readonly toolId: ToolId;
  readonly effect: ToolEffect;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly effectId?: string;
  readonly reconciliation: ReconciliationState;
}
