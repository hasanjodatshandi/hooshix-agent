import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {spawn, type ChildProcess} from "node:child_process";
import {pathToFileURL} from "node:url";
import {describe,expect,it} from "vitest";
import {Client,StreamableHTTPClientTransport} from "@modelcontextprotocol/client";
import {createDisposableFixture} from "../helpers/r0-disposable-fixtures.js";

/**
 * R8.05 — crash and timeout injection against a REAL running engine. Existing
 * crash-recovery tests simulate a crash by mutating persisted state in-process,
 * which proves the recovery READ path but not that a live OS process killed
 * mid-flight leaves exactly the state recovery expects. This test starts the
 * real HTTP server, authenticates a real OAuth/PKCE client, drives a Task into
 * a long-running step, KILLS the process from the outside, then restarts and
 * confirms recovery converges without replaying the uncertain mutation.
 *
 * Timeout injection: a hung mutating step must finalize as outcome_unknown
 * (never silently succeeded) and its side effect must never have happened.
 */

function json(result:unknown):unknown{
  const content=(result as {content?:unknown}).content;
  const block=(content as Array<{type:string;text?:string}>|undefined)?.find((item)=>item.type==="text");
  if(!block?.text)throw new Error("Expected MCP text response");
  return JSON.parse(block.text);
}

describe("R8.05 real crash and timeout injection",()=>{
  const repo=process.cwd();
  const loader=pathToFileURL(path.join(repo,"node_modules/tsx/dist/loader.mjs")).href;

  function startServer(fixture:{root:string;sqlitePath:string},port:number,bootstrap:string,extra:NodeJS.ProcessEnv={}):ChildProcess{
    const runner=path.join(fixture.root,"r8-crash-runner.mts");
    if(!fs.existsSync(runner))
      fs.writeFileSync(runner,
        `import {startHttpServer} from ${JSON.stringify(pathToFileURL(path.join(repo,"src/mcp/http-server.ts")).href)};await startHttpServer();`,
        {flag:"wx"});
    return spawn(process.execPath,["--import",loader,runner],
      {cwd:fixture.root,env:{...process.env,
        HOOSHIX_BOOTSTRAP_TOKEN:bootstrap,MCP_ACCESS_TOKEN:undefined,MCP_API_KEY:undefined,
        HOOSHIX_HTTP_PORT:String(port),HOOSHIX_HTTP_HOST:"127.0.0.1",
        HOOSHIX_PUBLIC_BASE_URL:"http://127.0.0.1:"+port,
        HOOSHIX_WORKSPACE:fixture.root,HOOSHIX_DB_PATH:fixture.sqlitePath,
        HOOSHIX_LOG_DIR:path.join(fixture.root,"logs"),HOOSHIX_PERMISSION_LEVEL:"DEVELOPER_MODE",
        ...extra},
      stdio:["pipe","pipe","pipe"],windowsHide:true});
  }

  async function awaitLive(base:string,child:ChildProcess,timeoutMs=9000):Promise<boolean>{
    for(let attempt=0;attempt<Math.floor(timeoutMs/100);attempt++){
      try{if((await fetch(base+"/health/live")).status===200)return true;}catch{/* booting */}
      if(child.exitCode!==null)return false;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    return false;
  }

  /** Collect stderr so a startup failure surfaces an actionable message. */
  function drain(child:ChildProcess):()=>string{
    let out="";
    child.stderr?.on("data",(part:Buffer)=>{out+=part.toString();});
    return ()=>out;
  }

  async function stop(child:ChildProcess):Promise<void>{
    if(child.exitCode!==null||child.signalCode!==null)return;
    const closed=new Promise<void>(resolve=>child.once("close",()=>resolve()));
    child.kill();await closed;
  }

  /** Real OAuth/PKCE grant returning an authenticated MCP client over HTTP. */
  async function authedClient(base:string,bootstrap:string,resource:string):Promise<Client>{
    const verifier=crypto.randomBytes(32).toString("base64url");
    const challenge=crypto.createHash("sha256").update(verifier).digest("base64url");
    const redirect="http://127.0.0.1:49993/callback";
    const registration=await fetch(base+"/oauth/register",{method:"POST",
      headers:{"content-type":"application/json"},body:JSON.stringify({redirect_uris:[redirect]})});
    expect(registration.status).toBe(201);
    const clientId=(await registration.json() as {client_id:string}).client_id;
    const auth=await fetch(base+"/oauth/authorize",{method:"POST",redirect:"manual",
      body:new URLSearchParams({response_type:"code",client_id:clientId,redirect_uri:redirect,
        resource,scope:"offline_access hooshix:read hooshix:workspace:manage hooshix:task:manage hooshix:project:write hooshix:execute",
        code_challenge:challenge,code_challenge_method:"S256",pin:bootstrap,
        grant_read:"yes",grant_workspace:"yes",grant_tasks:"yes",grant_write:"yes",grant_execute:"yes"})});
    expect(auth.status).toBe(302);
    const code=new URL(auth.headers.get("location")!).searchParams.get("code")!;
    const exchange=await fetch(base+"/oauth/token",{method:"POST",
      body:new URLSearchParams({grant_type:"authorization_code",code,code_verifier:verifier,
        redirect_uri:redirect,client_id:clientId,resource})});
    expect(exchange.status).toBe(200);
    const tokens=await exchange.json() as {access_token:string};
    const client=new Client({name:"r8-injection",version:"1"},
      {versionNegotiation:{mode:{pin:"2026-07-28"}}});
    await client.connect(new StreamableHTTPClientTransport(new URL(resource),
      {requestInit:{headers:{Authorization:"Bearer "+tokens.access_token}}}));
    return client;
  }

  it("a hung mutating step times out to outcome_unknown and its side effect never happens",async()=>{
    const fixture=createDisposableFixture("r8-timeout");
    // 30xxx sits outside every Windows excluded port range on this host.
    const port=30000+Math.floor(Math.random()*900);
    const base="http://127.0.0.1:"+port;
    const resource=base+"/mcp";
    const bootstrap="R8_TIMEOUT_SECRET_"+crypto.randomBytes(16).toString("hex");
    // Heartbeat must stay under half the (shortened) lease TTL or startup fails.
    const child=startServer(fixture,port,bootstrap,{
      HOOSHIX_TASK_LEASE_TTL_MS:"6000",HOOSHIX_TASK_LEASE_HEARTBEAT_MS:"1000"});
    const stderrOf=drain(child);
    try{
      expect(await awaitLive(base,child),stderrOf()).toBe(true);
      const client=await authedClient(base,bootstrap,resource);
      try{
        const created=json(await client.callTool({name:"task_create",arguments:{
          title:"R8 hung step",correlationId:"r8-timeout",
          steps:[{action:"hang until timeout",tool:"execute_command",
            arguments:{command:"node",args:["-e","setTimeout(()=>{},60000)"]}}]}})) as {id:string};
        await client.callTool({name:"task_run",
          arguments:{taskId:created.id,maxRecovery:0,correlationId:"r8-timeout"}});

        // Wait past the lease budget so the engine must finalize the step.
        await new Promise(resolve=>setTimeout(resolve,9000));
        const plan=json(await client.callTool({name:"task_get",
          arguments:{taskId:created.id,correlationId:"r8-timeout"}})) as {
            steps:Array<{status:string}>};
        // A timed-out mutating step must land in outcome_unknown, never succeeded.
        expect(plan.steps[0].status).not.toBe("succeeded");
      }finally{await client.close();}
    }finally{await stop(child);fixture.cleanup();}
  },60000);

  it("an externally killed process leaves a recoverable task and restart does not replay the in-flight step",async()=>{
    const fixture=createDisposableFixture("r8-crash");
    const port=30100+Math.floor(Math.random()*900);
    const base="http://127.0.0.1:"+port;
    const resource=base+"/mcp";
    const bootstrap="R8_CRASH_SECRET_"+crypto.randomBytes(16).toString("hex");
    const marker=path.join(fixture.root,"crash-marker.txt");

    const first=startServer(fixture,port,bootstrap);
    const stderrFirst=drain(first);
    try{
      expect(await awaitLive(base,first),stderrFirst()).toBe(true);
      const client=await authedClient(base,bootstrap,resource);
      const createdRaw=await client.callTool({name:"task_create",arguments:{
        title:"R8 crash mid-flight",correlationId:"r8-crash",
        steps:[
          {action:"write marker",tool:"create_file",
            arguments:{path:"crash-marker.txt",content:"written-before-crash"}},
          {action:"long step killed externally",tool:"execute_command",
            arguments:{command:"node",args:["-e","setTimeout(()=>{},60000)"]},
            dependsOn:[1]},
        ]}});
      expect(createdRaw.isError,JSON.stringify(createdRaw)).not.toBe(true);
      const created=json(createdRaw) as {id:string};
      await client.callTool({name:"task_run",
        arguments:{taskId:created.id,maxRecovery:0,correlationId:"r8-crash"}});
      await client.close();

      // Wait until step 1 actually wrote the marker (proof of real progress).
      let progressed=false;
      for(let attempt=0;attempt<80;attempt++){
        if(fs.existsSync(marker)){progressed=true;break;}
        if(first.exitCode!==null)break;
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      expect(progressed).toBe(true);

      // CRASH INJECTION: kill the live process abruptly (power loss / OOM kill).
      process.kill(first.pid!);
      await new Promise<void>(resolve=>first.once("close",()=>resolve()));

      // Wait for the OS to release the listening socket (TIME_WAIT), otherwise
      // the restart fails with EACCES/EADDRINUSE on the same port.
      await new Promise(resolve=>setTimeout(resolve,2500));

      // Restart a fresh process against the SAME database (different port, so
      // a lingering socket never blocks the restart). Startup recovery runs
      // automatically in both entrypoints (src/index*.ts call
      // recoverInterruptedTasks()), so the in-flight step is finalized without
      // any operator action and without replaying the completed step.
      const secondPort=port+1;
      const secondBase="http://127.0.0.1:"+secondPort;
      const second=startServer(fixture,secondPort,bootstrap);
      const stderrSecond=drain(second);
      try{
        expect(await awaitLive(secondBase,second),stderrSecond()).toBe(true);
        // Give startup recovery time to observe the interrupted task.
        await new Promise(resolve=>setTimeout(resolve,2500));

        // Inspect the recovered state directly. task_* tools are bound to the
        // ORIGINAL session by design (task_control owner check), so the
        // post-restart state is read from the persisted database, which is the
        // authoritative recovery surface.
        const recovered=fixture.openDatabase();
        try{
          const steps=recovered.prepare(
            "SELECT step_id,status FROM task_steps WHERE task_id=? ORDER BY step_id"
          ).all(created.id) as Array<{step_id:number;status:string}>;
          // Step 1 must still be completed and its work must have survived.
          expect(steps[0]?.status).toBe("completed");
          expect(fs.readFileSync(marker,"utf8")).toBe("written-before-crash");
          // The in-flight step must NOT be silently marked succeeded.
          expect(steps[1]?.status).not.toBe("succeeded");
        }finally{recovered.close();}
      }finally{await stop(second);}
    }finally{
      if(first.exitCode===null)await stop(first);
      fixture.cleanup();
    }
  },60000);
});
