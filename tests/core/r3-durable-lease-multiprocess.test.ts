import fs from "node:fs";
import {spawn,spawnSync,type ChildProcessWithoutNullStreams} from "node:child_process";
import {randomUUID} from "node:crypto";
import {describe,expect,it} from "vitest";
import {createDisposableFixture} from "../helpers/r0-disposable-fixtures.js";

const BOOTSTRAP=[
  "import {saveTaskPlan} from './src/core/memory/task-repository.ts';",
  "saveTaskPlan({id:process.env.R3_LEASE_TASK_ID,task:'disposable lease fixture',",
  "steps:[{id:1,action:'read',tool:'get_system_info',arguments:{},status:'pending'}]},'planning');",
  "console.log(JSON.stringify({bootstrapped:true}));",
].join("\n");
const COMPETE=[
  "import fs from 'node:fs';",
  "import {acquireTaskLease,releaseTaskLease} from './src/core/memory/task-lease.ts';",
  "console.log('READY');",
  "while(!fs.existsSync(process.env.R3_START_FILE)) await new Promise(r=>setTimeout(r,5));",
  "try {",
  "  const lease=acquireTaskLease(process.env.R3_LEASE_TASK_ID,process.env.R3_OWNER,4000);",
  "  console.log('RESULT '+JSON.stringify({winner:true,...lease}));",
  "  await new Promise(r=>setTimeout(r,850));",
  "  releaseTaskLease(lease);",
  "} catch(error) {",
  "  console.log('RESULT '+JSON.stringify({winner:false,error:error instanceof Error?error.message:String(error)}));",
  "}",
].join("\n");
const FENCE=[
  "import {acquireTaskLease,releaseTaskLease} from './src/core/memory/task-lease.ts';",
  "import {runWithTaskLeaseContext} from './src/infrastructure/composition/r3-task-lease-context.ts';",
  "import {saveTaskStatus} from './src/core/memory/task-repository.ts';",
  "const newLease=acquireTaskLease(process.env.R3_LEASE_TASK_ID,'new-process-owner',4000);",
  "let oldOwnerRejected=false;",
  "try {",
  "  await runWithTaskLeaseContext({...JSON.parse(process.env.R3_OLD_LEASE),lost:false},async()=>{",
  "    try{saveTaskStatus(process.env.R3_LEASE_TASK_ID,'completed');}",
  "    catch(e){if(e instanceof Error&&e.message==='task_lease_fenced')oldOwnerRejected=true;else throw e;}",
  "  });",
  "  await runWithTaskLeaseContext(newLease,async()=>saveTaskStatus(process.env.R3_LEASE_TASK_ID,'planning'));",
  "  console.log(JSON.stringify({oldOwnerRejected,newVersion:newLease.version}));",
  "}finally{releaseTaskLease(newLease);}",
].join("\n");

function childArgs(code:string):string[]{return ["--import","tsx","--input-type=module","-e",code];}
function awaitReady(child:ChildProcessWithoutNullStreams):Promise<void>{
  return new Promise((resolve,reject)=>{
    let seen="";
    const timeout=setTimeout(()=>reject(new Error("fixture_child_startup_timeout: "+seen)),12000);
    child.stdout.on("data",(value:Buffer)=>{seen+=value.toString();if(seen.includes("READY\n")){clearTimeout(timeout);resolve();}});
    child.once("exit",code=>{if(!seen.includes("READY\n")){clearTimeout(timeout);reject(new Error("fixture_child_early_exit: "+code+" "+seen));}});
  });
}
function closed(child:ChildProcessWithoutNullStreams):Promise<number>{
  return new Promise((resolve,reject)=>{
    child.once("error",reject);
    child.once("close",code=>resolve(code??-1));
  });
}

describe("R3.07 multiprocess Task lease and monotonic fencing",()=>{
  it("allows one and only one of two independent processes, and rejects superseded owner's write",async()=>{
    const fixture=createDisposableFixture("r3lease");
    const taskId=randomUUID(),startFile=fixture.root+"\\lease-start.marker";
    const env={...process.env,HOOSHIX_DB_PATH:fixture.sqlitePath,R3_LEASE_TASK_ID:taskId,R3_START_FILE:startFile};
    let a:ChildProcessWithoutNullStreams|undefined,b:ChildProcessWithoutNullStreams|undefined;
    try{
      const bootstrap=spawnSync(process.execPath,childArgs(BOOTSTRAP),{
        cwd:process.cwd(),env,encoding:"utf8",timeout:12000,windowsHide:true,
      });
      expect(bootstrap.status,bootstrap.stderr||bootstrap.stdout).toBe(0);
      a=spawn(process.execPath,childArgs(COMPETE),{
        cwd:process.cwd(),env:{...env,R3_OWNER:"competing-owner-a"},windowsHide:true,
      });
      b=spawn(process.execPath,childArgs(COMPETE),{
        cwd:process.cwd(),env:{...env,R3_OWNER:"competing-owner-b"},windowsHide:true,
      });
      let outputA="",outputB="",errors="";
      a.stdout.on("data",v=>{outputA+=v.toString();});
      b.stdout.on("data",v=>{outputB+=v.toString();});
      a.stderr.on("data",v=>{errors+=v.toString();});
      b.stderr.on("data",v=>{errors+=v.toString();});
      const exitA=closed(a),exitB=closed(b);
      await Promise.all([awaitReady(a),awaitReady(b)]);
      fs.writeFileSync(startFile,"go",{flag:"wx"});
      expect(await Promise.all([exitA,exitB]),errors).toEqual([0,0]);
      const results=[outputA,outputB].map(output=>{
        const line=output.split(/\r?\n/).find(line=>line.startsWith("RESULT "));
        expect(line,output).toBeDefined();
        return JSON.parse(line!.slice(7)) as {winner:boolean;error?:string;version?:number;taskId?:string;ownerId?:string;leaseToken?:string;lost?:boolean};
      });
      const winners=results.filter(row=>row.winner),losers=results.filter(row=>!row.winner);
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expect(losers[0].error).toBe("task_lease_conflict");
      const fenced=spawnSync(process.execPath,childArgs(FENCE),{
        cwd:process.cwd(),encoding:"utf8",timeout:12000,windowsHide:true,
        env:{...env,R3_OLD_LEASE:JSON.stringify(winners[0])},
      });
      expect(fenced.status,fenced.stderr||fenced.stdout).toBe(0);
      const result=JSON.parse(fenced.stdout.trim()) as {oldOwnerRejected:boolean;newVersion:number};
      expect(result.oldOwnerRejected).toBe(true);
      expect(result.newVersion).toBeGreaterThan(winners[0].version!);
    }finally{
      a?.kill();b?.kill();
      fixture.cleanup();
    }
  },35000);
});
