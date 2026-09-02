export interface RecoveryEvent {
  recoveryId: string;
  correlationId: string;
  action: string;
  reason: string;
  retryCount: number;
  startedAt: string;
  completedAt?: string;
  status: "started" | "completed" | "failed";
}

export interface RecoveryObservabilitySink {
  record(event: RecoveryEvent): void;
}

export class MemoryRecoveryObservability implements RecoveryObservabilitySink {
  private readonly events: RecoveryEvent[] = [];

  record(event: RecoveryEvent): void {
    this.events.push(event);
  }

  getEvents(correlationId?: string): RecoveryEvent[] {
    return correlationId
      ? this.events.filter((event) => event.correlationId === correlationId)
      : [...this.events];
  }
}
