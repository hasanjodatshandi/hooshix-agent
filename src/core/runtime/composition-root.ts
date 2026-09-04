import { createLocalToolExecutor } from "../executor/local-tool-executor.js";
import { ExecutionTraceService } from "../trace/execution-trace-service.js";
import { PersistentRecoveryObservability } from "../trace/persistent-recovery-observability.js";
import { PersistentRecoveryRepository } from "../trace/recovery-repository.js";
import { SqliteTraceRepository } from "../trace/trace-repository.js";
import { UnifiedRecoveryService } from "../trace/unified-recovery-service.js";
import { UnifiedTimelineService } from "../trace/unified-timeline-service.js";
import { TaskRuntimeService, type TaskRuntimeDependencies } from "./task-runtime-service.js";

export function createRuntimeDependencies(): TaskRuntimeDependencies {
  const traceRepository = new SqliteTraceRepository();
  const recoveryRepository = new PersistentRecoveryRepository();
  return {
    createExecutor: createLocalToolExecutor,
    recoveryProvider: new UnifiedRecoveryService(
      new ExecutionTraceService(traceRepository),
      new PersistentRecoveryObservability(recoveryRepository)
    ),
    timeline: new UnifiedTimelineService(traceRepository, recoveryRepository),
    recoveryRepository
  };
}

export function createTaskRuntimeService(): TaskRuntimeService {
  return new TaskRuntimeService(createRuntimeDependencies());
}
