import type { ExecutionTraceService } from "./execution-trace-service.js";
import { analyzeTraceFailure, type DebugFinding } from "./failure-analyzer.js";

export class AgentDebugService {
  constructor(private readonly traceService: ExecutionTraceService) {}

  diagnose(correlationId: string): DebugFinding {
    const trace = this.traceService.getTrace(correlationId);
    return analyzeTraceFailure(trace);
  }
}
