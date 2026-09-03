import type { ExecutionTraceEvent } from "../memory/execution-trace.js";

export interface ReplayStep {
  id: string;
  source: string;
  type: string;
  timestamp: string;
  payload: unknown;
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
      id: event.id,
      source: event.source,
      type: event.type,
      timestamp: event.timestamp,
      payload: event.payload
    }))
  };
}
