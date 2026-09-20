import type { RecoveryEvent, RecoveryObservabilitySink } from "./recovery-observability.js";
import { PersistentRecoveryRepository } from "./recovery-repository.js";
import {bestEffortTelemetry} from "./telemetry-degradation.js";

export class PersistentRecoveryObservability implements RecoveryObservabilitySink {
  constructor(private readonly repository = new PersistentRecoveryRepository()) {}

  record(event: RecoveryEvent): void {
    bestEffortTelemetry(()=>this.repository.save(event));
  }
}
