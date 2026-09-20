import {randomUUID} from "node:crypto";
import {acquireTaskLease,releaseTaskLease,renewTaskLease,
  type TaskLease} from "../memory/task-lease.js";
import {runWithTaskLeaseContext} from "../../infrastructure/composition/r3-task-lease-context.js";
import {serviceInstanceId} from "./execution-context.js";

/** One process-independent writer per Task. The heartbeat continues while an
 * external tool is awaiting completion; lost ownership fences all subsequent
 * Task state/receipt writes. */
export async function withTaskExecutionLease<T>(
  taskId:string,run:()=>Promise<T>,
  options?:{ttlMs?:number;heartbeatMs?:number;ownerId?:string},
):Promise<T>{
  const ttlMs=options?.ttlMs??30000,heartbeatMs=options?.heartbeatMs??5000;
  if(!Number.isSafeInteger(heartbeatMs)||heartbeatMs<10||heartbeatMs>=ttlMs/2)
    throw new Error("invalid_task_lease_heartbeat");
  const lease:TaskLease=acquireTaskLease(taskId,
    options?.ownerId??(serviceInstanceId+":"+randomUUID()),ttlMs);
  const heartbeat=setInterval(()=>{
    try{if(!renewTaskLease(lease,ttlMs))lease.lost=true;}
    catch{lease.lost=true;}
  },heartbeatMs);
  heartbeat.unref();
  try{
    return await runWithTaskLeaseContext(lease,run);
  }finally{
    clearInterval(heartbeat);
    releaseTaskLease(lease); // exact owner/token/epoch; cannot release successor
  }
}
