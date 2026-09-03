import { getResumableTasks, getResumePoint, getTaskExecutions } from "../memory/resume-memory.js";
import type { RecoveryAction } from "./recovery-engine.js";
import type { RecoveryProvider } from "../trace/unified-recovery-service.js";
import { PersistentRecoveryRepository } from "../trace/recovery-repository.js";

export interface RecoverySession {
  task: unknown;
  resumeStep: unknown;
  executions: unknown[];
  recovery?: RecoveryAction;
}

export function restoreInterruptedTasks(provider?: RecoveryProvider): RecoverySession[] {
  if (provider) {
    for (const event of new PersistentRecoveryRepository().findIncomplete()) {
      provider.recordLifecycle({ ...event, status: "failed", completedAt: new Date().toISOString(), reason: `${event.reason}; interrupted before completion` });
    }
  }
  return getResumableTasks().map((task: any) => {
    const correlationId = typeof task.correlation_id === "string" ? task.correlation_id : undefined;
    return {
      task,
      resumeStep: getResumePoint(task.id),
      executions: getTaskExecutions(task.id),
      recovery: provider && correlationId
        ? provider.decideRecovery(provider.analyzeFailure(correlationId))
        : undefined
    };
  });
}
