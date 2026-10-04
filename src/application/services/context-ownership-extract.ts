import type { TaskPlan } from "../dto/legacy-task-plan.js";
import type { HeldOwnership } from "../../domain/context/ownership-fence.js";

/**
 * CI-G5 — extract the ownership triple a Task recorded at creation.
 *
 * Returns undefined for an unbound Task (created with the flag OFF, or a code
 * path that never resolved a Context) — the fence then no-ops, exactly as it
 * does for every Task created before this flag existed. A contextId recorded
 * without a usable epoch/binding is likewise treated as unbound rather than
 * being silently fenced.
 */
export function heldOwnershipFromPlan(plan: TaskPlan): HeldOwnership | undefined {
  const context = plan.executionContext;
  const contextId = context?.contextId;
  const epoch = context?.ownershipEpoch;
  const binding = context?.createdByBindingId;
  if (!contextId || typeof epoch !== "number" || !Number.isSafeInteger(epoch) || !binding) {
    return undefined;
  }
  return { contextId, ownershipEpoch: epoch, createdByBindingId: binding };
}
