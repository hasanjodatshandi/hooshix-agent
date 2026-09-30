import { AsyncLocalStorage } from "node:async_hooks";

export interface TaskLeaseContext {
  readonly taskId:string;
  readonly ownerId:string;
  readonly leaseToken:string;
  readonly version:number;
  lost:boolean;
}
const activeTaskLease=new AsyncLocalStorage<TaskLeaseContext>();
export function getTaskLeaseContext():TaskLeaseContext|undefined {
  return activeTaskLease.getStore();
}
export function runWithTaskLeaseContext<T>(lease:TaskLeaseContext,callback:()=>Promise<T>):Promise<T> {
  return activeTaskLease.run(lease,callback);
}
