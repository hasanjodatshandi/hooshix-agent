import type { RecoveryEvent, RecoveryObservabilitySink } from "./recovery-observability.js";
import { PersistentRecoveryRepository } from "./recovery-repository.js";

export class PersistentRecoveryObservability implements RecoveryObservabilitySink {
  constructor(private readonly repository = new PersistentRecoveryRepository()) {}

  record(event: RecoveryEvent): void {
    this.repository.save(event);
  }
}
