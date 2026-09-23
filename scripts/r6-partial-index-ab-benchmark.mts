/**
 * R6 G6 disposable four-way experiment: v16/full-v17/partial/shorter-partial indexes.
 * Prior-to-candidate migrator is read from pinned committed R6.03 baseline (v16),
 * ONLY temporary marker-owned fixture index is swapped; never run against operational DB.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {performance} from "node:perf_hooks";
import {spawnSync} from "node:child_process";
import {pathToFileURL} from "node:url";
import Database from "better-sqlite3";
import {transformSync} from "esbuild";
import {applyBaseSchemaMigration} from "../src/adapters/outbound/persistence/sqlite/base-schema.migration.js";
import {runMigrations as runCurrentMigrations} from "../src/core/memory/database/migrations.js";

const repo=process.cwd();
const historicalBaseline="ad96009"; // R6.03: real migration v16, before candidate v17
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),"hooshix-r6-partial-index-"));
const marker=path.join(fixture,".r6-partial-index-fixture");
fs.writeFileSync(marker,"R6 PARTIAL INDEX DISPOSABLE FIXTURE",{flag:"wx"});
let db:Database.Database|undefined;
const round=(v:number)=>+v.toFixed(3);
const benchmark=(fn:()=>unknown)=>{
  for(let i=0;i<2;i++)fn();
  const times:number[]=[];
  for(let i=0;i<7;i++){const started=performance.now();fn();times.push(performance.now()-started);}
  times.sort((a,b)=>a-b);
  return {medianMs:round(times[3]),p95Ms:round(times[6]),minMs:round(times[0]),samples:7};
};
const transpile=(source:string)=>transformSync(source,{loader:"ts",format:"esm",target:"es2022"}).code;
function replaceOnce(source:string,search:string,replacement:string):string{
  if(source.split(search).length!==2)throw new Error("unexpected committed-source import shape");
  return source.replace(search,replacement);
}
try{
  const committed=spawnSync("git",["show",`${historicalBaseline}:src/core/memory/database/migrations.ts`],{
    cwd:repo,encoding:"utf8",maxBuffer:1024*1024,timeout:20000,windowsHide:true
  });
  if(committed.status!==0||!committed.stdout)throw new Error("pinned R6.03 v16 migrator unavailable: "+String(committed.error?.message||committed.stderr).slice(0,250));
  if(!committed.stdout.includes('migrate(db,16,"r5-oauth-credential-repository"')||
     committed.stdout.includes("r6-metrics-task-category-created-index"))
    throw new Error("pinned R6.03 commit is not the independently verified v16 baseline");
  const canonical=pathToFileURL(path.join(repo,"src","infrastructure","project-path-identity.ts")).href;
  const oldMigration=replaceOnce(committed.stdout,
    'from "../../../infrastructure/project-path-identity.js"',
    'from '+JSON.stringify(canonical));
  const oldModule=path.join(fixture,"migration-v16.mjs");
  fs.writeFileSync(oldModule,transpile(oldMigration),{flag:"wx"});
  const {runMigrations:runHistorical}=await import(pathToFileURL(oldModule).href) as {
    runMigrations:(db:Database.Database)=>void
  };
  const bridgePath=path.join(fixture,"database-bridge.mjs");
  fs.writeFileSync(bridgePath,`let current; export function bind(db){current=db}
    export function withAgentDatabase(fn){if(!current)throw Error("fixture DB not bound");return fn(current)}`,
    {flag:"wx"});
  const sourcePath=path.join(repo,"src","adapters","outbound","persistence","sqlite",
    "repositories","agent-metrics-query.adapter.ts");
  let adapter=fs.readFileSync(sourcePath,"utf8");
  adapter=replaceOnce(adapter,'from "../../../../../core/memory/database.js"',
    'from '+JSON.stringify(pathToFileURL(bridgePath).href));
  adapter=replaceOnce(adapter,'from "../../../../../core/executor/handlers/metrics-arguments.js"',
    'from '+JSON.stringify(pathToFileURL(path.join(repo,"src","core","executor",
       "handlers","metrics-arguments.ts")).href));
  const adapterPath=path.join(fixture,"metrics-adapter.mjs");
  fs.writeFileSync(adapterPath,transpile(adapter),{flag:"wx"});
  db=new Database(path.join(fixture,"metrics.sqlite"));
  db.pragma("foreign_keys = ON");db.pragma("journal_mode = WAL");
  applyBaseSchemaMigration(db);
  runHistorical(db);
  const historicalVersion=(db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as {v:number}).v;
  if(historicalVersion!==16)throw new Error("historical fixture did not stop at v16");
  const index="idx_tool_calls_task_category_created_at";
  if(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get(index))
    throw new Error("historical schema already contains candidate index");
  const bridge=await import(pathToFileURL(bridgePath).href) as {
    bind:(db:Database.Database)=>void
  };
  bridge.bind(db);
  const {getAgentMetrics}=await import(pathToFileURL(adapterPath).href) as {
    getAgentMetrics:(args:Record<string,unknown>)=>unknown
  };
  const names=["read_file","write_file","execute_command","search_files",
    "list_directory","task_run","git_status"];
  const insert=db.prepare(`INSERT INTO tool_calls(correlation_id,task_id,tool,status,category,
    created_at,completed_at,duration_ms) VALUES (?,?,?,?,?,?,?,?)`);
  const insertExecution=db.prepare(`INSERT INTO executions(task_id,step_id,action,result,status,
    correlation_id,created_at) VALUES (?,?,?,?,?,?,?)`);
  const insertRecovery=db.prepare(`INSERT INTO recovery_events(recovery_id,correlation_id,action,
    reason,retry_count,started_at,completed_at,status) VALUES (?,?,?,?,?,?,?,?)`);
  const startTime=Date.parse("2026-09-21T12:00:00.000Z");
  const seed=db.transaction((start:number,end:number,extra=false)=>{
    for(let i=start;i<end;i++){
      const timestamp=new Date(startTime-(i%604800)*1000).toISOString();
      insert.run((extra?"r6-extra-":"r6-corr-")+i,i%5<3?null:"r6-task-"+i%64,
        names[i%names.length],i%11===0?"failed":"success",
        i%5===0?"orchestration":"workflow",timestamp,timestamp,(i*17)%5000);
      if(!extra&&i%20===0)insertExecution.run("r6-task-"+i%64,i,"workflow_action",
        "fixture",i%100===0?"failed":"completed","r6-corr-"+i,timestamp);
      if(!extra&&i%100===0)insertRecovery.run("r6-recovery-"+i,"r6-corr-"+i,
        "retry","fixture",i%3,timestamp,timestamp,
        i%200===0?"completed":"started");
    }
  });
  seed(0,250000);
  const rows=()=> (db!.prepare("SELECT COUNT(*) AS n FROM tool_calls").get() as {n:number}).n;
  if(rows()!==250000)throw new Error("wrong fixture size");
  const sql="SELECT tool,status,duration_ms,correlation_id,task_id,created_at,error,category "+
    "FROM tool_calls WHERE created_at <= ? AND task_id = ? AND category = ? "+
    "ORDER BY created_at DESC LIMIT ? OFFSET ?";
  const args=["2026-09-22T00:00:00.000Z","r6-task-23","workflow",50,25] as const;
  const plan=()=>db!.prepare("EXPLAIN QUERY PLAN "+sql).all(...args)
    .map((row:any)=>row.detail);
  const profiles=()=>({
    global:benchmark(()=>getAgentMetrics({limit:50,offset:0})),
    filtered:benchmark(()=>getAgentMetrics({taskId:"r6-task-23",category:"workflow",
      limit:50,offset:25,from:"2026-09-01",to:"2026-09-22"})),
    paged:benchmark(()=>getAgentMetrics({limit:50,offset:1000})),
    recentSQL:benchmark(()=>db!.prepare(sql).all(...args))
  });
  const snapshot=()=>getAgentMetrics({taskId:"r6-task-23",category:"workflow",
    limit:50,offset:25,from:"2026-09-01",to:"2026-09-22"});
  const before=profiles(),beforePlan=plan(),beforeResult=snapshot();
  const rollbackWrite=()=>{
    db!.exec("SAVEPOINT r6_index_insert_comparison");
    try{
      const time=performance.now();
      seed(250000,253000,true);
      return round(performance.now()-time);
    }finally{
      db!.exec("ROLLBACK TO SAVEPOINT r6_index_insert_comparison; RELEASE SAVEPOINT r6_index_insert_comparison");
    }
  };
  const writesBefore=[rollbackWrite(),rollbackWrite(),rollbackWrite()];
  if(rows()!==250000)throw new Error("baseline write probe changed row count");
  const beforePages=db.pragma("page_count",{simple:true});
  const migrationStart=performance.now();
  runCurrentMigrations(db); // applies ONLY the real pending v17 migration
  const migrationMs=round(performance.now()-migrationStart);
  const latest=(db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as {v:number}).v;
  if(latest!==17||!db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get(index))
    throw new Error("candidate migration was not applied exactly once");
  const after=profiles(),afterPlan=plan(),afterResult=snapshot();
  const normalized=(value:unknown)=>JSON.stringify(value,(key,val)=>
    key==="snapshotAt"?"[normalized]":val);
  if(normalized(beforeResult)!==normalized(afterResult))
    throw new Error("candidate migration changed the actual Metrics result");
  const writesAfter=[rollbackWrite(),rollbackWrite(),rollbackWrite()];
  if(rows()!==250000)throw new Error("candidate write probe changed row count");
  const partialIndex="idx_tool_calls_task_category_created_at";
  const fullPages=db.pragma("page_count",{simple:true});
  const fullFree=db.pragma("freelist_count",{simple:true});
  // Hypothetical replacement is confined to THIS disposable fixture only.
  // Never modify an existing migration's definition or any operator database.
  db.exec("DROP INDEX "+partialIndex+"; CREATE INDEX "+partialIndex+
    " ON tool_calls(task_id,category,created_at DESC) WHERE task_id IS NOT NULL");
  const partial=profiles(),partialPlan=plan(),partialResult=snapshot();
  if(normalized(beforeResult)!==normalized(partialResult))
    throw new Error("hypothetical partial index changed Metrics payload");
  if(!partialPlan.some(x=>x.includes("USING INDEX "+partialIndex)))
    throw new Error("SQLite did not select the partial index for task-scoped query");
  const writesPartial=[rollbackWrite(),rollbackWrite(),rollbackWrite()];
  if(rows()!==250000)throw new Error("partial write probe changed row count");
  const partialPages=db.pragma("page_count",{simple:true});
  const partialFree=db.pragma("freelist_count",{simple:true});
  // Additional HYPOTHETICAL narrower partial index, also on this fixture only.
  // Category becomes a residual filter; inspect the real adapter plan and payload.
  db.exec("DROP INDEX "+partialIndex+"; CREATE INDEX "+partialIndex+
    " ON tool_calls(task_id,created_at DESC) WHERE task_id IS NOT NULL");
  const slim=profiles(),slimPlan=plan(),slimResult=snapshot();
  if(normalized(beforeResult)!==normalized(slimResult))
    throw new Error("hypothetical slim partial index changed Metrics payload");
  if(!slimPlan.some(x=>x.includes("USING INDEX "+partialIndex)))
    throw new Error("SQLite did not select the slim partial index for task-scoped query");
  const writesSlim=[rollbackWrite(),rollbackWrite(),rollbackWrite()];
  if(rows()!==250000)throw new Error("slim write probe changed row count");
  const slimPages=db.pragma("page_count",{simple:true});
  const slimFree=db.pragma("freelist_count",{simple:true});

  const beforeWriteMedian=[...writesBefore].sort((a,b)=>a-b)[1];
  const afterWriteMedian=[...writesAfter].sort((a,b)=>a-b)[1];
  const results={
    fixture:"marker-owned disposable 250k SQLite, 60% NULL task_id, v16/full-v17/partial/slim-partial hypothetical",
    platform:process.platform,node:process.version,
    rows:rows(),historicalVersion,candidateVersion:latest,
    baseline:before,candidate:after,partial,slim,beforePlan,afterPlan,partialPlan,slimPlan,
    beforePages,afterPages:db.pragma("page_count",{simple:true}),
    migrationMs,write3000RowsMs:{before:writesBefore,after:writesAfter,partial:writesPartial,
      medianBefore:beforeWriteMedian,medianAfter:afterWriteMedian,
      medianPartial:[...writesPartial].sort((a,b)=>a-b)[1],
      slim:writesSlim,medianSlim:[...writesSlim].sort((a,b)=>a-b)[1]},
    allocatedFixturePages:{full:fullPages-fullFree,partial:partialPages-partialFree,
      slim:slimPages-slimFree},
    resultParity:true,integrity:db.pragma("quick_check",{simple:true})
  };
  console.log("R6_PARTIAL_INDEX_EXPERIMENT "+JSON.stringify(results));
}finally{
  if(db?.open)db.close();
  // Cleanup only this script's new marker-owned temporary fixture, never a user path.
  if(fs.existsSync(marker)&&fs.readFileSync(marker,"utf8")==="R6 PARTIAL INDEX DISPOSABLE FIXTURE")
    fs.rmSync(fixture,{recursive:true,force:true});
}