import { AsyncLocalStorage } from "node:async_hooks";

/** Transport of the persisted, consumed approval ID. Never itself authorizes an effect. */
const current=new AsyncLocalStorage<number>();
export function runWithTrustedTaskApproval<T>(approvalId:number,execute:()=>T):T {
  if(!Number.isSafeInteger(approvalId)||approvalId<=0) throw new Error("invalid_trusted_task_approval");
  return current.run(approvalId,execute);
}
export function getTrustedTaskApproval():number|undefined {return current.getStore();}
