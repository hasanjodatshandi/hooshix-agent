import { getExecutionTrace, type ExecutionTraceEvent } from "../memory/execution-trace.js";

export interface TraceRepository {
  findByCorrelationId(correlationId: string): ExecutionTraceEvent[];
}

export class SqliteTraceRepository implements TraceRepository {
  findByCorrelationId(correlationId: string): ExecutionTraceEvent[] {
    return getExecutionTrace(correlationId);
  }
}
