import {randomUUID} from "node:crypto";
import type Database from "better-sqlite3";
import {withAgentDatabase} from "../../../../../core/memory/database/index.js";
import {getTaskLeaseContext, type TaskLeaseContext} from "../../../../../core/runtime/r3-task-lease-context.js";

export type TaskLease=TaskLeaseContext;
const iso=(time:number)=>new Date(time).toISOString();
const MIN_TTL_MS=100;
const MAX_TTL_MS=120_000;

function validateTtl(ttlMs:number):void {
  if(!Number.isSafeInteger(ttlMs)||ttlMs<MIN_TTL_MS||ttlMs>MAX_TTL_MS)
    throw new Error("invalid_task_lease_ttl");
}

/** Atomic SQLite competition: the conflict clause increments a MONOTONIC
 * fencing epoch. Released rows remain in place so stale tokens cannot regain
 * authority after a new runner acquires the same Task. */
export function acquireTaskLease(taskId:string,ownerId:string,ttlMs=30000):TaskLease {
  validateTtl(ttlMs);
  if(!taskId||!ownerId)throw new Error("invalid_task_lease_identity");
  return withAgentDatabase(db=>{
    const now=Date.now(),started=iso(now),expires=iso(now+ttlMs);
    const leaseToken=randomUUID();
    const changed=db.prepare(`
      INSERT INTO task_leases(task_id,owner_id,lease_token,version,
        acquired_at,heartbeat_at,expires_at,released_at)
      VALUES(?,?,?,1,?,?,?,NULL)
      ON CONFLICT(task_id) DO UPDATE SET
        owner_id=excluded.owner_id,lease_token=excluded.lease_token,
        version=task_leases.version+1,acquired_at=excluded.acquired_at,
        heartbeat_at=excluded.heartbeat_at,expires_at=excluded.expires_at,
        released_at=NULL
      WHERE task_leases.expires_at<=excluded.acquired_at OR
        task_leases.released_at IS NOT NULL
    `).run(taskId,ownerId,leaseToken,started,started,expires);
    if(changed.changes!==1)throw new Error("task_lease_conflict");
    const row=db.prepare("SELECT version FROM task_leases WHERE task_id=?")
      .get(taskId) as {version:number};
    return {taskId,ownerId,leaseToken,version:row.version,lost:false};
  });
}

/** A heartbeat does not revive an expired/foreign/stale token. */
export function renewTaskLease(lease:TaskLease,ttlMs=30000):boolean {
  validateTtl(ttlMs);
  if(lease.lost)return false;
  return withAgentDatabase(db=>{
    const now=Date.now(),updated=db.prepare(`
      UPDATE task_leases SET heartbeat_at=?,expires_at=?
      WHERE task_id=? AND owner_id=? AND lease_token=? AND version=?
        AND released_at IS NULL AND expires_at>?
    `).run(iso(now),iso(now+ttlMs),lease.taskId,lease.ownerId,lease.leaseToken,lease.version,iso(now));
    if(updated.changes!==1)lease.lost=true;
    return updated.changes===1;
  });
}

export function releaseTaskLease(lease:TaskLease):boolean {
  return withAgentDatabase(db=>{
    const now=iso(Date.now());
    const changed=db.prepare(`
      UPDATE task_leases SET released_at=?,expires_at=?
      WHERE task_id=? AND owner_id=? AND lease_token=? AND version=? AND released_at IS NULL
    `).run(now,now,lease.taskId,lease.ownerId,lease.leaseToken,lease.version);
    lease.lost=true;
    return changed.changes===1;
  });
}

/** Every guarded Task mutation checks the actual DB epoch and expiry in the
 * same synchronous SQLite connection as its write transaction. No async-local
 * context on a Task that currently has a live lease => deny out-of-band writes.
 * A runtime with a superseded lease is NEVER permitted to persist a late
 * result, including a previously successful external effect. */
export function assertTaskLeaseWrite(db:Database.Database,taskId:string):void {
  const held=getTaskLeaseContext();
  const row=db.prepare(`SELECT owner_id,lease_token,version,expires_at,released_at
    FROM task_leases WHERE task_id=?`).get(taskId) as {
    owner_id:string;lease_token:string;version:number;expires_at:string;released_at:string|null;
  }|undefined;
  const now=iso(Date.now());
  if(held){
    if(held.lost||held.taskId!==taskId||!row||
      row.owner_id!==held.ownerId||row.lease_token!==held.leaseToken||
      row.version!==held.version||row.released_at!==null||row.expires_at<=now)
      throw new Error("task_lease_fenced");
    return;
  }
  if(row&&row.released_at===null&&row.expires_at>now)
    throw new Error("task_lease_conflict");
}
