import type { ExecutionTraceEvent } from "../memory/execution-trace.js";
import type { RecoveryEvent } from "./recovery-observability.js";
import type { TraceRepository } from "./trace-repository.js";
import { PersistentRecoveryRepository } from "./recovery-repository.js";

export interface UnifiedTimelineEvent {
  source: "execution" | "recovery";
  type: string;
  timestamp: string;
  data: unknown;
}

export interface UnifiedTimelineReport {
  correlationId: string;
  totalEvents: number;
  finalStatus: string;
  events: UnifiedTimelineEvent[];
}

export class UnifiedTimelineService {
  constructor(
    private readonly traceRepository: TraceRepository,
    private readonly recoveryRepository = new PersistentRecoveryRepository()
  ) {}

  build(correlationId: string): UnifiedTimelineReport {
    const execution = this.traceRepository.findByCorrelationId(correlationId);
    const recovery = this.recoveryRepository.findByCorrelationId(correlationId);
    const events = [
      ...execution.map((event): UnifiedTimelineEvent => ({
        source: "execution",
        type: event.type,
        timestamp: event.timestamp,
        data: event.data
      })),
      ...recovery.map((event): UnifiedTimelineEvent => ({
        source: "recovery",
        type: `recovery_${event.status}`,
        timestamp: event.status === "started" ? event.startedAt : event.completedAt ?? event.startedAt,
        data: event
      }))
    ].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    return {
      correlationId,
      totalEvents: events.length,
      finalStatus: findFinalStatus(execution, recovery),
      events
    };
  }
}

function findFinalStatus(execution: ExecutionTraceEvent[], recovery: RecoveryEvent[]): string {
  for (let index = execution.length - 1; index >= 0; index--) {
    if (execution[index].type !== "task") continue;
    const data = execution[index].data as { status?: unknown };
    if (typeof data?.status === "string") return data.status;
  }
  if (recovery.some((event) => event.status === "failed")) return "failed";
  return "unknown";
}
