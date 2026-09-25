/**
 * R6.04: A/B comparison of an evidence-based composite Metrics index.
 * Run with: pnpm exec tsx scripts/r6-index-evaluation.mts
 * NO live DB, external workspace, operational server, or existing backup access.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {performance} from "node:perf_hooks";
import type Database from "better-sqlite3";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"hooshix-r6-index-"));
const marker=path.join(root,".r6-index-fixture");
fs.writeFileSync(marker,"R6.04 DISPOSABLE FIXTURE",{flag:"wx"});
const databasePath=path.join(root,"metrics-index-fixture.sqlite");
process.env.HOOSHIX_DB_PATH=databasePath;
process.env.HOOSHIX_LOG_DIR=path.join(root,"logs");
process.env.HOOSHIX_WORKSPACE=root;
const round=(value:number)=>+value.toFixed(3);
const benchmark=(fn:()=>unknown)=>{
  for(let i=0;i<2;i++)fn();
  const samples:number[]=[];
  for(let i=0;i<7;i++){const start=performance.now();fn();samples.push(performance.now()-start);}
  samples.sort((a,b)=>a-b);
  return {medianMs:round(samples[3]),p95Ms:round(samples[6]),minMs:round(samples[0])};
};
const sql="SELECT tool,status,duration_ms,correlation_id,task_id,created_at,error,category FROM tool_calls WHERE created_at <= ? AND task_id = ? AND category = ? ORDER BY created_at DESC LIMIT ? OFFSET ?";
const args=["2026-09-22T00:00:00.000Z","r6-task-23","workflow",50,25] as const;
let disposeDb:(()=>void)|undefined;
try{
  const {withAgentDatabase,closeAgentDatabase}=await import("../src/core/memory/database/index.js");
  disposeDb=closeAgentDatabase;
  const {getAgentMetrics}=await import("../src/adapters/outbound/persistence/sqlite/repositories/agent-metrics-query.adapter.js");
  const db=withAgentDatabase(x=>x) as Database.Database;
  const insert=db.prepare(`INSERT INTO tool_calls(correlation_id,task_id,tool,status,category,created_at,
    completed_at,duration_ms) VALUES(?,?,?,?,?,?,?,?)`);
  const insertExec=db.prepare(`INSERT INTO executions(task_id,step_id,action,result,status,correlation_id,created_at)
    VALUES(?,?,?,?,?,?,?)`);
  const insertRecovery=db.prepare(`INSERT INTO recovery_events(recovery_id,correlation_id,action,reason,retry_count,
    started_at,completed_at,status) VALUES(?,?,?,?,?,?,?,?)`);
  const names=["read_file","write_file","execute_command","search_files","list_directory","task_run","git_status"];
  const base=Date.parse("2026-09-21T12:00:00.000Z");
  const seed=db.transaction((first:number,limit:number)=>{
    for(let i=first;i<limit;i++){
      const ts=new Date(base-(i%604800)*1000).toISOString();
      insert.run("r6-corr-"+i,"r6-task-"+i%64,names[i%names.length],
        i%11===0?"failed":"success",i%5===0?"orchestration":"workflow",ts,ts,(i*17)%5000);
      if(i%20===0)insertExec.run("r6-task-"+i%64,i,"workflow_action","fixture",
        i%100===0?"failed":"completed","r6-corr-"+i,ts);
      if(i%100===0)insertRecovery.run("r6-recovery-"+i,"r6-corr-"+i,"retry","fixture",i%3,
        ts,ts,i%200===0?"completed":"started");
    }
  });
  seed(0,250000);
  const count=()=> (db.prepare("SELECT COUNT(*) AS n FROM tool_calls").get() as {n:number}).n;
  if(count()!==250000)throw new Error("seed mismatch");
  const plans=()=>db.prepare("EXPLAIN QUERY PLAN "+sql).all(...args).map((row:any)=>row.detail);
  const profiles=()=>({
    global:benchmark(()=>getAgentMetrics({limit:50,offset:0})),
    filtered:benchmark(()=>getAgentMetrics({taskId:"r6-task-23",category:"workflow",
      limit:50,offset:25,from:"2026-09-01",to:"2026-09-22"})),
    paged:benchmark(()=>getAgentMetrics({limit:50,offset:1000})),
    filteredRecent:benchmark(()=>db.prepare(sql).all(...args))
  });
  const baselineProfiles=profiles();
  const baselinePlan=plans();
  const snapshotBefore=getAgentMetrics({taskId:"r6-task-23",category:"workflow",
    limit:50,offset:25,from:"2026-09-01",to:"2026-09-22"});
  const insertMore=db.transaction((start:number,limit:number)=>{
    for(let i=start;i<limit;i++){
      const ts=new Date(base-(i%604800)*1000).toISOString();
      insert.run("r6-extra-"+i,"r6-task-"+i%64,names[i%names.length],
        i%11===0?"failed":"success",i%5===0?"orchestration":"workflow",ts,ts,(i*17)%5000);
    }
  });
  // Matched rollback-only insertion workload on the SAME disposable DB.
  const writeBenchmark=(start:number)=>{
    db.exec("SAVEPOINT r6_index_write");
    let ms=0;
    try{
      const begun=performance.now();
      insertMore(start,start+3000);
      ms=performance.now()-begun;
    }finally{
      db.exec("ROLLBACK TO SAVEPOINT r6_index_write; RELEASE SAVEPOINT r6_index_write");
    }
    return round(ms);
  };
  const beforeWrite=[writeBenchmark(250000),writeBenchmark(250000),writeBenchmark(250000)];
  const pagesBefore=db.pragma("page_count",{simple:true}) as number;
  const begin=performance.now();
  db.exec("CREATE INDEX idx_tool_calls_task_category_created_at ON tool_calls(task_id,category,created_at DESC)");
  const indexBuildMs=round(performance.now()-begin);
  const indexedProfiles=profiles();
  const indexedPlan=plans();
  const snapshotAfter=getAgentMetrics({taskId:"r6-task-23",category:"workflow",
    limit:50,offset:25,from:"2026-09-01",to:"2026-09-22"});
  const normalized=(value:typeof snapshotBefore)=>JSON.stringify({
    ...value,pagination:{...value.pagination,snapshotAt:"[normalized]"}
  });
  if(normalized(snapshotBefore)!==normalized(snapshotAfter))
    throw new Error("candidate index changed the returned Metrics result");
  const afterWrite=[writeBenchmark(250000),writeBenchmark(250000),writeBenchmark(250000)];
  const pagesAfter=db.pragma("page_count",{simple:true}) as number;
  const results={
    environment:{platform:process.platform,node:process.version,fixture:"marked new temp SQLite",
      toolCallRows:count(),executionRows:12500,recoveryRows:2500,integrity:db.pragma("quick_check",{simple:true})},
    candidate:"idx_tool_calls_task_category_created_at ON tool_calls(task_id,category,created_at DESC)",
    indexBuildMs,pagesBefore,pagesAfter,
    baselineProfiles,indexedProfiles,baselinePlan,indexedPlan,resultParityVerified:true,
    rollbackOnly3000InsertMs:{before:beforeWrite,after:afterWrite}
  };
  if(count()!==250000)throw new Error("write workload modified baseline fixture");
  closeAgentDatabase();
  console.log("R6_INDEX_EVALUATION_REPORT "+JSON.stringify(results));
}finally{
  // Ensure SQLite releases Windows file locks even when a fixture assertion fails.
  disposeDb?.();
  // Never use an environment-provided, user-selected, or unmarked path for cleanup.
  if(fs.readFileSync(marker,"utf8")==="R6.04 DISPOSABLE FIXTURE")
    fs.rmSync(root,{recursive:true,force:true});
}
