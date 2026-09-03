import { randomUUID } from "node:crypto";
import type { RecoveryAction, RecoveryExecutionContext } from "../recovery/recovery-engine.js";
import type { TaskPlan } from "../planner/task-planner.js";
import type { ExecutionTraceEvent } from "../memory/execution-trace.js";
import { analyzeTraceFailure, type DebugFinding } from "./failure-analyzer.js";
import { createRecoveryDecision } from "./recovery-decision.js";
import { applySelfHealing, shouldContinueAfterRecovery } from "./self-healing-controller.js";
import { PersistentRecoveryObservability } from "./persistent-recovery-observability.js";
import type { RecoveryEvent, RecoveryObservabilitySink } from "./recovery-observability.js";

export interface RecoveryProvider {
  analyzeFailure(correlationId: string): DebugFinding;
  decideRecovery(finding: DebugFinding): RecoveryAction;
  executeRecovery(plan: TaskPlan, action: RecoveryAction, context: RecoveryExecutionContext): boolean;
  recordLifecycle(event: RecoveryEvent): void;
}

export class UnifiedRecoveryService implements RecoveryProvider {
  constructor(
    private readonly traceService: { getTrace(correlationId: string): ExecutionTraceEvent[] },
    private readonly sink: RecoveryObservabilitySink = new PersistentRecoveryObservability()
  ) {}

  analyzeFailure(correlationId: string): DebugFinding {
    return analyzeTraceFailure(this.traceService.getTrace(correlationId));
  }

  decideRecovery(finding: DebugFinding): RecoveryAction {
    return createRecoveryDecision(finding);
  }

  recordLifecycle(event: RecoveryEvent): void {
    this.sink.record(event);
  }

  executeRecovery(plan: TaskPlan, action: RecoveryAction, context: RecoveryExecutionContext): boolean {
    if (!shouldContinueAfterRecovery(action)) return false;
    const base = {
      recoveryId: randomUUID(),
      correlationId: context.correlationId,
      action: action.type,
      reason: action.reason,
      retryCount: context.retryCount ?? 1,
      startedAt: new Date().toISOString()
    };
    this.recordLifecycle({ ...base, status: "started" });
    try {
      applySelfHealing(plan, action, context.stepIndex);
      this.recordLifecycle({ ...base, completedAt: new Date().toISOString(), status: "completed" });
      return true;
    } catch {
      this.recordLifecycle({ ...base, completedAt: new Date().toISOString(), status: "failed" });
      return false;
    }
  }
}
