import type { RecoveryEvent, RecoveryObservabilitySink } from "./recovery-observability.js";

export class RecoveryLifecycleTracker {
  constructor(private readonly sink: RecoveryObservabilitySink) {}

  start(input: Omit<RecoveryEvent, "status" | "completedAt">): string {
    const event = { ...input, status: "started" as const };
    this.sink.record(event);
    return input.recoveryId;
  }

  complete(event: Omit<RecoveryEvent, "status">): void {
    this.sink.record({ ...event, status: "completed" });
  }

  fail(event: Omit<RecoveryEvent, "status">): void {
    this.sink.record({ ...event, status: "failed" });
  }
}
