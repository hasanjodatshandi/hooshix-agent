/**
 * R6.03: reproducible representative SQLite metrics-query baseline.
 * Execute with pnpm exec tsx scripts/r6-metrics-benchmark.mts.
 * Creates and removes ONLY a marked, fresh temporary fixture database.
 * Never points to, reads, or deletes the operator's configured SQLite file.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {performance} from "node:perf_hooks";
import type Database from "better-sqlite3";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"hooshix-r6-metrics-"));
const dbPath=path.join(root,"metrics-fixture.sqlite");
fs.writeFileSync(path.join(root,".r6-metrics-fixture"),"R6.03 DISPOSABLE FIXTURE", {flag:"wx"});
process.env.HOOSHIX_DB_PATH=dbPath;
process.env.HOOSHIX_LOG_DIR=path.join(root,"logs");
process.env.HOOSHIX_WORKSPACE=root;
const report:{fixture:string; platform:string; node:string; results:Array<Record<string,unknown>>}={
  fixture:"temporary marker-owned SQLite only",platform:process.platform,node:process.version,results:[]
};
function sample(fn:()=>unknown,reps=7){
  for(let i=0;i<2;i++)fn();
  const times:number[]=[];
  for(let i=0;i<reps;i++){const t=performance.now();fn();times.push(performance.now()-t);}
  times.sort((a,b)=>a-b);
  return {minMs:+times[0].toFixed(3),medianMs:+times[Math.floor(times.length/2)].toFixed(3),
    p95Ms:+times[Math.ceil(times.length*.95)-1].toFixed(3),samples:times.length};
}
try{
  const {withAgentDatabase,closeAgentDatabase}=await import("../src/core/memory/database/index.js");
  const {getAgentMetrics}=await import("../src/adapters/outbound/persistence/sqlite/repositories/agent-metrics-query.adapter.js");
  // The process-local database is created by the real migration/bootstrap path.
  const db=withAgentDatabase(x=>x) as Database.Database;
  const toolNames=["read_file","write_file","execute_command","search_files","list_directory","task_run","git_status"];
  const insert=db.prepare(`INSERT INTO tool_calls(correlation_id,task_id,tool,status,category,created_at,
    completed_at,duration_ms) VALUES (?,?,?,?,?,?,?,?)`);
  const execInsert=db.prepare(`INSERT INTO executions(task_id,step_id,action,result,status,correlation_id,
    created_at) VALUES (?,?,?,?,?,?,?)`);
  const recoveryInsert=db.prepare(`INSERT INTO recovery_events(recovery_id,correlation_id,action,reason,
    retry_count,started_at,completed_at,status) VALUES (?,?,?,?,?,?,?,?)`);
  const base=Date.parse("2026-09-21T12:00:00.000Z");
  const seed=db.transaction((from:number,to:number)=>{
    for(let i=from;i<to;i++){
      const timestamp=new Date(base-(i%604800)*1000).toISOString();
      insert.run("r6-corr-"+i,"r6-task-"+i%64,toolNames[i%toolNames.length],
        i%11===0?"failed":"success",i%5===0?"orchestration":"workflow",timestamp,timestamp,(i*17)%5000);
      if(i%20===0)execInsert.run("r6-task-"+i%64,i,"workflow_action","fixture",
        i%100===0?"failed":"completed","r6-corr-"+i,timestamp);
      if(i%100===0)recoveryInsert.run("r6-recovery-"+i,"r6-corr-"+i,"retry","fixture",i%3,
        timestamp,timestamp,i%200===0?"completed":"started");
    }
  });
  const sqlPlans=[
    ["workflow_stats","SELECT COUNT(*) AS total, SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed FROM tool_calls WHERE (category IS NULL OR category='workflow')",[]],
    ["filtered_recent","SELECT tool,status,duration_ms,correlation_id,task_id,created_at,error,category FROM tool_calls WHERE created_at <= ? AND task_id = ? AND category = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",["2026-09-22T00:00:00.000Z","r6-task-23","workflow",50,25]],
    ["failed_tools","SELECT tool,COUNT(*) AS failures FROM tool_calls WHERE status='failed' GROUP BY tool ORDER BY failures DESC,tool LIMIT 10",[]],
    ["recovery_duration","SELECT AVG(CASE WHEN completed_at IS NOT NULL AND julianday(completed_at)>julianday(started_at) AND (julianday(completed_at)-julianday(started_at))*86400000 < 300000 THEN (julianday(completed_at)-julianday(started_at))*86400000 END) AS average_ms FROM recovery_events WHERE started_at > datetime('now','-7 days')",[]],
    ["failed_executions","SELECT COUNT(*) AS count FROM executions WHERE status='failed' AND action NOT LIKE 'recovery_%'",[]]
  ] as const;
  for(const n of [25000,250000]){
    const previous=n===25000?0:25000;
    const seedStart=performance.now();
    seed(previous,n);
    const seedMs=Math.round(performance.now()-seedStart);
    const actual=(db.prepare("SELECT COUNT(*) AS n FROM tool_calls").get() as {n:number}).n;
    if(actual!==n)throw new Error("fixture row count mismatch "+actual);
    const global=sample(()=>getAgentMetrics({limit:50,offset:0}));
    const filtered=sample(()=>getAgentMetrics({taskId:"r6-task-23",category:"workflow",limit:50,offset:25,
      from:"2026-09-01",to:"2026-09-22"}));
    const paged=sample(()=>getAgentMetrics({limit:50,offset:1000}));
    const plans=sqlPlans.map(([name,sql,args])=>({name,detail:db.prepare("EXPLAIN QUERY PLAN "+sql)
      .all(...args).map((row:any)=>row.detail)}));
    report.results.push({toolCallRows:n,executionRows:(db.prepare("SELECT COUNT(*) AS n FROM executions").get() as {n:number}).n,
      recoveryRows:(db.prepare("SELECT COUNT(*) AS n FROM recovery_events").get() as {n:number}).n,
      seedMs,queries:{global,filtered,paged},plans,
      quickCheck:db.pragma("quick_check",{simple:true})});
  }
  closeAgentDatabase();
  console.log("R6_METRICS_BENCHMARK_REPORT "+JSON.stringify(report));
}finally{
  // Closed temporary fixture only; never use a configurable path in rmSync.
  if(fs.readFileSync(path.join(root,".r6-metrics-fixture"),"utf8")==="R6.03 DISPOSABLE FIXTURE")
    fs.rmSync(root,{recursive:true,force:true});
}
