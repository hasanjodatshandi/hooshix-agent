import type { TaskPlan } from "../planner/task-planner.js";
import type { RecoveryAction, RecoveryExecutionContext } from "./recovery-engine.js";
import { UnifiedRecoveryService } from "../trace/unified-recovery-service.js";
import { MemoryRecoveryObservability } from "../trace/recovery-observability.js";
import { randomUUID } from "node:crypto";

export function recoverAndContinue(
  plan: TaskPlan,
  action: RecoveryAction,
  context?: RecoveryExecutionContext
): boolean {
  const runtimeContext = context ?? { correlationId: plan.id ?? randomUUID(), sink: new MemoryRecoveryObservability() };
  return new UnifiedRecoveryService({ getTrace: () => [] }, runtimeContext.sink).executeRecovery(plan, action, runtimeContext);
}
