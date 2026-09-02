import type { ExecutionTraceService } from "./execution-trace-service.js";
import { analyzeTraceFailure, type DebugFinding } from "./failure-analyzer.js";
import { createRecoveryDecision } from "./recovery-decision.js";
import type { RecoveryAction } from "../recovery/recovery-engine.js";

export class AgentSelfHealingService {
  constructor(private readonly traceService: ExecutionTraceService) {}

  analyze(correlationId: string): { finding: DebugFinding; recovery: RecoveryAction } {
    const trace = this.traceService.getTrace(correlationId);
    const finding = analyzeTraceFailure(trace);

    return {
      finding,
      recovery: createRecoveryDecision(finding)
    };
  }
}
