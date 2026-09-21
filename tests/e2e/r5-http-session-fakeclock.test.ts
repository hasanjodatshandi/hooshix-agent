import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {spawn,type ChildProcess} from "node:child_process";
import {pathToFileURL} from "node:url";
import {describe,expect,it} from "vitest";
import {createDisposableFixture,reserveEphemeralLoopbackPort} from "../helpers/r0-disposable-fixtures.js";

describe("R5 real HTTP operator session lifecycle with an isolated fake clock",()=>{
  it("expires idle and absolute sessions while retaining an active session before its absolute deadline",async()=>{
    const fixture=createDisposableFixture("r5-session");
    const repo=process.cwd();
    const portLease=await reserveEphemeralLoopbackPort();
    const port=portLease.port;await portLease.close();
    const base="http://127.0.0.1:"+port;
    const bootstrap="r5-operator-fixture-"+crypto.randomBytes(32).toString("hex");
    const runner=path.join(fixture.root,"r5-fake-clock-http.mts");
    fs.writeFileSync(runner,`
      let current=Date.parse("2026-09-21T00:00:00Z");
      Date.now=()=>current;
      const {startHttpServer}=await import(${JSON.stringify(pathToFileURL(path.join(repo,"src/mcp/http-server.ts")).href)});
      process.stdin.setEncoding("utf8");
      process.stdin.on("data",data=>{
        const change=Number(data.trim());
        if(!Number.isSafeInteger(change)||change<0)process.stdout.write("ERR\\n");
        else{current+=change;process.stdout.write("OK\\n");}
      });
      await startHttpServer();
    `,{flag:"wx"});
    const child=spawn(process.execPath,["--import",
      pathToFileURL(path.join(repo,"node_modules","tsx","dist","loader.mjs")).href,runner],{
      cwd:fixture.root,windowsHide:true,stdio:["pipe","pipe","pipe"],
      env:{...process.env,HOOSHIX_DB_PATH:fixture.sqlitePath,
        HOOSHIX_LOG_DIR:path.join(fixture.root,"logs"),
        HOOSHIX_WORKSPACE:fixture.root,
        HOOSHIX_BOOTSTRAP_TOKEN:bootstrap,
        MCP_BIND_HOST:"127.0.0.1",MCP_PORT:String(port),MCP_PUBLIC_BASE_URL:base,
        MCP_ACCESS_TOKEN:undefined,MCP_API_KEY:undefined}
    });
    let logs="";
    child.stderr.on("data",(data:Buffer)=>{logs+=data.toString();});
    async function stop(processRef:ChildProcess){
      if(processRef.exitCode!==null||processRef.signalCode!==null)return;
      const closed=new Promise<void>(resolve=>processRef.once("close",()=>resolve()));
      processRef.kill();await closed;
    }
    async function advance(milliseconds:number){
      const acknowledged=new Promise<string>(resolve=>child.stdout.once("data",(data:Buffer)=>resolve(data.toString().trim())));
      child.stdin.write(String(milliseconds)+"\n");
      expect(await acknowledged).toBe("OK");
    }
    async function signIn(){
      const response=await fetch(base+"/operator/login",{
        method:"POST",body:new URLSearchParams({secret:bootstrap}),redirect:"manual"
      });
      expect(response.status).toBe(303);
      const cookie=response.headers.get("set-cookie")?.split(";")[0];
      expect(cookie).toMatch(/^hx_operator=/);
      return cookie!;
    }
    async function privateTools(cookie:string){
      return fetch(base+"/tools",{headers:{Cookie:cookie,Accept:"application/json"}});
    }
    try{
      let ready=false;
      for(let i=0;i<75;i++){
        try{if((await fetch(base+"/health/live")).status===200){ready=true;break;}}catch{/* booting */}
        if(child.exitCode!==null||child.signalCode!==null)break;
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      expect(ready,logs.slice(-1500)).toBe(true);
      const idleSession=await signIn();
      expect((await privateTools(idleSession)).status).toBe(200);
      await advance(30*60_000+1);
      expect((await privateTools(idleSession)).status).toBe(401);
      const absoluteSession=await signIn();
      for(let i=0;i<16;i++){
        await advance(29*60_000);
        expect((await privateTools(absoluteSession)).status).toBe(200);
      }
      await advance(17*60_000);
      expect((await privateTools(absoluteSession)).status).toBe(401);
    }finally{
      await stop(child);
      fixture.cleanup();
    }
  },30000);

  it.fails("R5 G5 blocker: OAuth authorization response must advertise and stamp its issuer",()=>{
    const source=fs.readFileSync(path.join(process.cwd(),"src","mcp","http-server.ts"),"utf8");
    expect(source).toContain("authorization_response_iss_parameter_supported:true");
    expect(source).toContain('params.set("iss",base)');
  });
});
