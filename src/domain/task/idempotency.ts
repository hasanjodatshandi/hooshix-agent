import type { IdempotencyKey, TaskId } from "../shared/ids.js";
export interface IdempotencyRequestIdentity { readonly key: IdempotencyKey; readonly canonicalRequestHash: string; readonly taskId: TaskId; }
export function compareIdempotency(existing: IdempotencyRequestIdentity, incomingHash: string): "same" | "conflict" {
  return existing.canonicalRequestHash === incomingHash ? "same" : "conflict";
}
