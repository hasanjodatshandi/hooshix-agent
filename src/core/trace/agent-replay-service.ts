import type { ExecutionTraceService } from "./execution-trace-service.js";
import { buildReplayReport, type ReplayReport } from "./replay-engine.js";

export class AgentReplayService {
  constructor(private readonly traceService: ExecutionTraceService) {}

  replayExecution(correlationId: string): ReplayReport {
    const trace = this.traceService.getTrace(correlationId);
    return buildReplayReport(correlationId, trace);
  }
}
