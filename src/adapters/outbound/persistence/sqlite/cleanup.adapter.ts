import { withAgentDatabase } from "../../../../core/memory/database/index.js";

export type RetentionClass =
  | "toolCalls" | "checkpoints" | "recoveryEvents" | "approvals" | "restoredBackups";
export type RetentionPolicy = Readonly<Record<RetentionClass,number>>;
export type RetentionCounts = Record<RetentionClass,number>;
export interface RetentionReport {
  readonly mode:"dry-run"|"delete";
  readonly at:string;
  readonly cutoffs:Readonly<Record<RetentionClass,string>>;
  readonly counts:Readonly<RetentionCounts>;
  readonly total:number;
}
export interface RetentionOptions {
  readonly policy?:RetentionPolicy;
  readonly nowMs?:number;
  readonly dryRun?:boolean;
}

/** Each retention class has an explicit, conservative deletion predicate.
 * Task plans, executions, unconsumed approvals, active recovery and unrestored
 * backups are deliberately outside this policy. OAuth has its own TTL cleanup.
 * Only static internal SQL is used; user input is bound as a cutoff parameter. */
const CLASSES=[
  {key:"toolCalls",table:"tool_calls",where:"created_at < ?"},
  {key:"checkpoints",table:"agent_checkpoints",
    where:"created_at < ? AND task_id IN (SELECT id FROM tasks WHERE status IN ('completed','failed','cancelled'))"},
  {key:"recoveryEvents",table:"recovery_events",where:"started_at < ? AND status != 'started'"},
  {key:"approvals",table:"approval_requests",where:"created_at < ? AND status = 'consumed'"},
  {key:"restoredBackups",table:"file_backups",
    where:"created_at < ? AND restored_at IS NOT NULL AND restored_at != 'absent'"},
] as const;

function validDays(days:number):boolean{return Number.isSafeInteger(days)&&days>=1&&days<=36500;}
export function createRetentionPolicy(days=90,
  overrides:Partial<RetentionPolicy>={}):RetentionPolicy{
  if(!validDays(days))throw new Error("Retention must be between 1 and 36500 whole days");
  const policy={} as Record<RetentionClass,number>;
  for(const item of CLASSES){
    const value=overrides[item.key]??days;
    if(!validDays(value))throw new Error("Invalid retention days for "+item.key);
    policy[item.key]=value;
  }
  return Object.freeze(policy);
}

/** Dry runs execute SELECT COUNT only; delete runs all five classes in one
 * transaction. Never delete active or unconsumed business records. */
export function runRetention(options:RetentionOptions={}):RetentionReport{
  const nowMs=options.nowMs??Date.now();
  if(!Number.isFinite(nowMs)||nowMs<0||!Number.isSafeInteger(nowMs))
    throw new Error("Invalid retention clock");
  const policy=options.policy??createRetentionPolicy();
  const cutoffs={} as Record<RetentionClass,string>;
  for(const item of CLASSES){
    const days=policy[item.key];
    if(!validDays(days))throw new Error("Invalid retention days for "+item.key);
    cutoffs[item.key]=new Date(nowMs-days*86_400_000).toISOString();
  }
  const dryRun=options.dryRun===true;
  return withAgentDatabase(db=>db.transaction(()=>{
    const counts={} as RetentionCounts;
    for(const item of CLASSES){
      const cutoff=cutoffs[item.key];
      if(dryRun){
        const result=db.prepare(`SELECT COUNT(*) AS n FROM ${item.table} WHERE ${item.where}`)
          .get(cutoff) as {n:number};
        counts[item.key]=result.n;
      }else{
        counts[item.key]=db.prepare(`DELETE FROM ${item.table} WHERE ${item.where}`)
          .run(cutoff).changes;
      }
    }
    return {mode:dryRun?"dry-run" as const:"delete" as const,
      at:new Date(nowMs).toISOString(),cutoffs,counts,
      total:Object.values(counts).reduce((sum,n)=>sum+n,0)};
  })());
}

/** Compatibility contract used by legacy callers. */
export function cleanupAgentData(retentionDays=90):Record<string,number>{
  return {...runRetention({policy:createRetentionPolicy(retentionDays)}).counts};
}
