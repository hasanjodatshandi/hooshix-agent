import type { ExecutionTraceEvent } from "../memory/execution-trace.js";
import type { TraceRepository } from "./trace-repository.js";

export class ExecutionTraceService {
  constructor(private readonly repository: TraceRepository) {}

  getTrace(correlationId: string): ExecutionTraceEvent[] {
    return this.repository.findByCorrelationId(correlationId);
  }
}
