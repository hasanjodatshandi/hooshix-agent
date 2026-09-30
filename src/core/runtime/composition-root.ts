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

// R3: the task tool module needs a shared runtime, but building it at module
// import time forces construction even when the MCP server never registers task
// tools. Keep the singleton here, at the composition root, resolved lazily on
// first use — the only place that decides object lifetime.
let sharedRuntime: TaskRuntimeService | undefined;
export function getTaskRuntimeService(): TaskRuntimeService {
  if (sharedRuntime === undefined) sharedRuntime = createTaskRuntimeService();
  return sharedRuntime;
}
