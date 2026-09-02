import type { ExecutionTraceEvent } from "../memory/execution-trace.js";

export interface ReplayStep {
  type: string;
  timestamp: string;
  data: unknown;
}

export interface ReplayReport {
  correlationId: string;
  totalEvents: number;
  steps: ReplayStep[];
}

export function buildReplayReport(correlationId: string, events: ExecutionTraceEvent[]): ReplayReport {
  return {
    correlationId,
    totalEvents: events.length,
    steps: events.map((event) => ({
      type: event.type,
      timestamp: event.timestamp,
      data: event.data
    }))
  };
}
