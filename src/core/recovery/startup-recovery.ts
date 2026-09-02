import { getResumableTasks, getResumePoint, getTaskExecutions } from "../memory/resume-memory.js";

export interface RecoverySession {
  task: unknown;
  resumeStep: unknown;
  executions: unknown[];
}

export function restoreInterruptedTasks(): RecoverySession[] {
  return getResumableTasks().map((task: any) => ({
    task,
    resumeStep: getResumePoint(task.id),
    executions: getTaskExecutions(task.id)
  }));
}
