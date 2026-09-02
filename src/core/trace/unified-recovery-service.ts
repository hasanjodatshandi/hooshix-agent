import type { RecoveryAction } from "../recovery/recovery-engine.js";
import type { ExecutionTraceEvent } from "../memory/execution-trace.js";
import { analyzeTraceFailure } from "./failure-analyzer.js";
import { createRecoveryDecision } from "./recovery-decision.js";

export interface RecoveryDecisionProvider {
  decide(correlationId: string): RecoveryAction;
}

export class UnifiedRecoveryService implements RecoveryDecisionProvider {
  constructor(private readonly traceService: { getTrace(correlationId: string): ExecutionTraceEvent[] }) {}

  decide(correlationId: string): RecoveryAction {
    return createRecoveryDecision(analyzeTraceFailure(this.traceService.getTrace(correlationId)));
  }
}
