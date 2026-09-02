import type { RecoveryAction } from "../recovery/recovery-engine.js";
import { createRecoveryDecision } from "../trace/recovery-decision.js";
import { analyzeTraceFailure } from "../trace/failure-analyzer.js";
import type { ExecutionTraceService } from "../trace/execution-trace-service.js";

export function createUnifiedRecovery(traceService: ExecutionTraceService, correlationId: string): RecoveryAction {
  const trace = traceService.getTrace(correlationId);
  return createRecoveryDecision(analyzeTraceFailure(trace));
}
