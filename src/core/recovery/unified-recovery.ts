import type { RecoveryAction } from "../recovery/recovery-engine.js";
import type { ExecutionTraceService } from "../trace/execution-trace-service.js";
import { UnifiedRecoveryService } from "../trace/unified-recovery-service.js";

export function createUnifiedRecovery(traceService: ExecutionTraceService, correlationId: string): RecoveryAction {
  return new UnifiedRecoveryService(traceService).decide(correlationId);
}
