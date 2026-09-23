import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {spawn} from "node:child_process";
import {pathToFileURL} from "node:url";
import {describe,expect,it} from "vitest";
import {Client,StreamableHTTPClientTransport} from "@modelcontextprotocol/client";
import {createDisposableFixture,reserveEphemeralLoopbackPort} from "../helpers/r0-disposable-fixtures.js";

/**
 * R8.02 — a REAL end-to-end Task lifecycle over the HTTP transport. Existing
 * Task-lifecycle tests run through an in-process stdio MCP client, which never
 * crosses the network boundary and never involves an OAuth principal or session.
 * This test spawns the real HTTP server, completes a real OAuth/PKCE
 * authorization-code grant with the full tool scopes, then drives the complete
 * create -> run -> approve -> resume -> report cycle through a real MCP client
 * over loopback HTTP — the same path a remote integrator takes.
 */
describe("R8.02 real Task lifecycle over HTTP/OAuth transport",()=>{
  function json(result:unknown):unknown{
    const content=(result as {content?:unknown}).content;
    const block=(content as Array<{type:string;text?:string}>|undefined)?.find((item)=>item.type==="text");
    if(!block?.text)throw new Error("Expected MCP text response");
    return JSON.parse(block.text);
  }

  it("runs create, run, approve, resume and report through a real OAuth-scoped MCP client",async()=>{
    const fixture=createDisposableFixture("r8-e2e");
    const lease=await reserveEphemeralLoopbackPort();
    const port=lease.port;await lease.close();
    const repo=process.cwd();
    const base="http://127.0.0.1:"+port;
    const resource=base+"/mcp";
    const bootstrap="R8_E2E_SECRET_"+crypto.randomBytes(32).toString("hex");
    const runner=path.join(fixture.root,"r8-e2e-runner.mts");
    fs.writeFileSync(runner,
      `import {startHttpServer} from ${JSON.stringify(pathToFileURL(path.join(repo,"src/mcp/http-server.ts")).href)};await startHttpServer();`,
      {flag:"wx"});
    const loader=pathToFileURL(path.join(repo,"node_modules/tsx/dist/loader.mjs")).href;
    const child=spawn(process.execPath,["--import",loader,runner],
      {cwd:fixture.root,env:{...process.env,
        HOOSHIX_BOOTSTRAP_TOKEN:bootstrap,MCP_ACCESS_TOKEN:undefined,MCP_API_KEY:undefined,
        MCP_PORT:String(port),MCP_BIND_HOST:"127.0.0.1",MCP_PUBLIC_BASE_URL:base,
        HOOSHIX_WORKSPACE:fixture.root,HOOSHIX_DB_PATH:fixture.sqlitePath,
        HOOSHIX_LOG_DIR:path.join(fixture.root,"logs"),HOOSHIX_PERMISSION_LEVEL:"DEVELOPER_MODE"},
      stdio:["pipe","pipe","pipe"],windowsHide:true});
    let stderr="";
    child.stderr.on("data",(part:Buffer)=>{stderr+=part.toString();});

    async function stop():Promise<void>{
      if(child.exitCode!==null||child.signalCode!==null)return;
      const closed=new Promise<void>(resolve=>child.once("close",()=>resolve()));
      child.kill();await closed;
    }

    try{
      // Wait for the unauthenticated liveness probe before anything else.
      for(let attempt=0;attempt<90;attempt++){
        try{if((await fetch(base+"/health/live")).status===200)break;}catch{/* booting */}
        if(child.exitCode!==null)break;
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      expect(child.exitCode,stderr).toBeNull();

      // Real OAuth/PKCE authorization-code grant with the full operator scopes.
      const verifier=crypto.randomBytes(32).toString("base64url");
      const challenge=crypto.createHash("sha256").update(verifier).digest("base64url");
      const redirect="http://127.0.0.1:49992/callback";
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
      const tokens=await exchange.json() as {access_token:string;refresh_token:string};
      expect(tokens.access_token).not.toBe(bootstrap);

      // A real MCP client over the network, authenticated with the issued token.
      const client=new Client({name:"r8-e2e-fixture",version:"1"},
        {versionNegotiation:{mode:{pin:"2026-07-28"}}});
      const transport=new StreamableHTTPClientTransport(new URL(resource),
        {requestInit:{headers:{Authorization:"Bearer "+tokens.access_token}}});
      await client.connect(transport);
      try{
        // The principal must be able to see the workspace it will operate in.
        const workspace=await client.callTool({name:"get_workspace",arguments:{}});
        expect(workspace.isError).not.toBe(true);

        // Full Task lifecycle exactly as a remote integrator drives it. Paths
        // resolve against the workspace root (the fixture directory).
        const created=json(await client.callTool({name:"task_create",arguments:{
          title:"R8.02 HTTP Task lifecycle",correlationId:"r8-e2e-task",
          steps:[
            {action:"create acceptance script",tool:"create_file",
              arguments:{path:"hello.cjs",content:"console.log('hello-from-http-task')"}},
            {action:"execute acceptance script",tool:"execute_command",
              arguments:{command:"node",args:["hello.cjs"]},dependsOn:[1]},
          ]}})) as {id:string};
        expect(typeof created.id).toBe("string");

        const run=json(await client.callTool({name:"task_run",
          arguments:{taskId:created.id,maxRecovery:0,correlationId:"r8-e2e-task"}})) as {
            status:string;approvalId?:number};
        // execute_command is approval-gated, so the run pauses before step 2.
        expect(run.status).toBe("pending_approval");
        expect(typeof run.approvalId).toBe("number");

        await client.callTool({name:"task_approve",
          arguments:{approvalId:run.approvalId!,correlationId:"r8-e2e-task"}});
        const resumed=json(await client.callTool({name:"task_resume",
          arguments:{approvalId:run.approvalId!,correlationId:"r8-e2e-task"}})) as {status:string};
        expect(resumed.status).toBe("completed");

        const gotten=json(await client.callTool({name:"task_get",
          arguments:{taskId:created.id,correlationId:"r8-e2e-task"}})) as {
            steps:Array<{status:string;output?:unknown}>};
        expect(gotten.steps.map((s)=>s.status)).toEqual(["completed","completed"]);
        expect(JSON.stringify(gotten.steps[1].output)).toContain("hello-from-http-task");

        const report=json(await client.callTool({name:"task_report",
          arguments:{taskId:created.id,correlationId:"r8-e2e-task"}})) as {
            status:string;timeline:{events:Array<{type:string;data?:{tool?:string}}>}};
        expect(report.status).toBe("completed");
        expect(report.timeline.events.some(
          (e)=>e.type==="tool_call"&&e.data?.tool==="create_file")).toBe(true);
      }finally{await client.close();}
    }finally{
      await stop();
      fixture.cleanup();
    }
  },60000);
});
