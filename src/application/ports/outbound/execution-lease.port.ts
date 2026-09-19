import type { TaskId } from "../../../domain/shared/ids.js";
export interface ExecutionLease { readonly taskId: TaskId; readonly ownerId: string; readonly fencingToken: number; readonly expiresAt: string; }
export interface ExecutionLeaseRepository {
  tryAcquire(input: { readonly taskId: TaskId; readonly ownerId: string; readonly now: string; readonly expiresAt: string }): Promise<ExecutionLease | null>;
  renew(input: ExecutionLease & { readonly nextExpiry: string }): Promise<boolean>;
  release(input: ExecutionLease): Promise<boolean>;
  get(taskId: TaskId): Promise<ExecutionLease | null>;
}
