import type { RecoveryEvent } from "./recovery-observability.js";
import { PersistentRecoveryRepository } from "./recovery-repository.js";

export interface RecoveryReplayReport {
  correlationId: string;
  recoveryCount: number;
  completed: number;
  failed: number;
  events: RecoveryEvent[];
}

export class RecoveryReplayService {
  constructor(private readonly repository = new PersistentRecoveryRepository()) {}

  replay(correlationId: string): RecoveryReplayReport {
    const events = this.repository.findByCorrelationId(correlationId);
    const latestByRecovery = new Map<string, RecoveryEvent>();
    for (const event of events) latestByRecovery.set(event.recoveryId, event);
    const recoveries = [...latestByRecovery.values()];
    return {
      correlationId,
      recoveryCount: recoveries.length,
      completed: recoveries.filter((event) => event.status === "completed").length,
      failed: recoveries.filter((event) => event.status === "failed").length,
      events
    };
  }
}
