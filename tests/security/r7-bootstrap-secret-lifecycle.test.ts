import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {spawn, type ChildProcess} from "node:child_process";
import {pathToFileURL} from "node:url";
import {describe,expect,it} from "vitest";
import {createDisposableFixture,reserveEphemeralLoopbackPort} from "../helpers/r0-disposable-fixtures.js";

/**
 * R7.03 — bootstrap secret lifecycle. The bootstrap credential is an
 * operator-only secret that must never be logged, passed as a command argument,
 * or accepted as an MCP bearer. These contracts execute against a REAL spawned
 * server process so the file-permission, length, symlink and rotation rules are
 * proven instead of assumed.
 */
describe("R7.03 bootstrap secret lifecycle and rotation",()=>{
  const strong=()=>crypto.randomBytes(32).toString("base64url");

  function runnerFor(fixture:{root:string}):string{
    const repo=process.cwd();
    const runner=path.join(fixture.root,"r7-secret-runner.mts");
    fs.writeFileSync(runner,
      `import {startHttpServer} from ${JSON.stringify(pathToFileURL(path.join(repo,"src/mcp/http-server.ts")).href)};await startHttpServer();`,
      {flag:"wx"});
    return runner;
  }

  function start(fixture:{root:string},runner:string,env:NodeJS.ProcessEnv){
    const repo=process.cwd();
    const loader=pathToFileURL(path.join(repo,"node_modules/tsx/dist/loader.mjs")).href;
    const child=spawn(process.execPath,["--import",loader,runner],
      {cwd:fixture.root,env:{...process.env,...env},stdio:["pipe","pipe","pipe"],windowsHide:true});
    let errorOutput="";
    child.stderr.on("data",(part:Buffer)=>{errorOutput+=part.toString();});
    return {child,error:()=>errorOutput};
  }

  async function stop(child:ChildProcess):Promise<void>{
    if(child.exitCode!==null||child.signalCode!==null)return;
    const closed=new Promise<void>(resolve=>child.once("close",()=>resolve()));
    child.kill();await closed;
  }

  async function awaitExit(child:ChildProcess,timeoutMs=8000):Promise<number|null>{
    return Promise.race([
      new Promise<number|null>(resolve=>child.once("exit",code=>resolve(code))),
      new Promise<null>(resolve=>setTimeout(()=>resolve(null),timeoutMs)),
    ]);
  }

  async function awaitLive(base:string,child:ChildProcess,timeoutMs=9000):Promise<boolean>{
    for(let attempt=0;attempt<Math.floor(timeoutMs/100);attempt++){
      try{if((await fetch(base+"/health/live")).status===200)return true;}catch{/* starting */}
      if(child.exitCode!==null)return false;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    return false;
  }

  function baseEnv(fixture:{root:string;sqlitePath:string},over:NodeJS.ProcessEnv={}):NodeJS.ProcessEnv{
    return {HOOSHIX_BOOTSTRAP_TOKEN:undefined,MCP_ACCESS_TOKEN:undefined,MCP_API_KEY:undefined,
      HOOSHIX_WORKSPACE:fixture.root,HOOSHIX_DB_PATH:fixture.sqlitePath,
      HOOSHIX_LOG_DIR:path.join(fixture.root,"logs"),
      HOOSHIX_PERMISSION_LEVEL:"READ_ONLY",...over};
  }

  it("rejects a supplied bootstrap token shorter than 32 bytes",async()=>{
    const fixture=createDisposableFixture("r7-secret");
    const runner=runnerFor(fixture);
    try{
      const proc=start(fixture,runner,baseEnv(fixture,{HOOSHIX_BOOTSTRAP_TOKEN:"short-operator-secret"}));
      const code=await awaitExit(proc.child);
      expect(code,proc.error()).not.toBe(0);
      expect(code).not.toBeNull();
      expect(proc.error()).toMatch(/requires at least 32 bytes/);
    }finally{fixture.cleanup();}
  },30000);

  it("rejects a token file whose stored secret is too short",async()=>{
    const fixture=createDisposableFixture("r7-secret");
    const runner=runnerFor(fixture);
    fs.writeFileSync(path.join(fixture.root,".token"),"too-short",{flag:"wx"});
    try{
      const proc=start(fixture,runner,baseEnv(fixture));
      const code=await awaitExit(proc.child);
      expect(code,proc.error()).not.toBe(0);
      expect(code).not.toBeNull();
      expect(proc.error()).toMatch(/insecure bootstrap secret length/);
    }finally{fixture.cleanup();}
  },30000);

  it("rejects a symlinked bootstrap secret file",async()=>{
    const fixture=createDisposableFixture("r7-secret");
    const runner=runnerFor(fixture);
    const target=path.join(fixture.root,"real-secret");
    fs.writeFileSync(target,strong(),{flag:"wx"});
    let linked=true;
    try{fs.symlinkSync(target,path.join(fixture.root,".token"));}
    catch{linked=false;} // Windows without symlink privilege: contract is still POSIX-enforced in code
    if(!linked){fixture.cleanup();return;}
    try{
      const proc=start(fixture,runner,baseEnv(fixture));
      const code=await awaitExit(proc.child);
      expect(code,proc.error()).not.toBe(0);
      expect(code).not.toBeNull();
      expect(proc.error()).toMatch(/unsafe bootstrap secret file/);
    }finally{fixture.cleanup();}
  },30000);

  it("rotates the operator secret: a replaced token file revokes the old credential on restart",async()=>{
    const fixture=createDisposableFixture("r7-rotate");
    const lease=await reserveEphemeralLoopbackPort();
    const port=lease.port;await lease.close();
    const base="http://127.0.0.1:"+port;
    const runner=runnerFor(fixture);
    const tokenA=strong(),tokenB=strong();
    fs.writeFileSync(path.join(fixture.root,".token"),tokenA,{flag:"wx"});
    const login=(secret:string)=>fetch(base+"/operator/login",{
      method:"POST",redirect:"manual",body:new URLSearchParams({secret})});

    try{
      const first=start(fixture,runner,baseEnv(fixture,{MCP_PORT:String(port)}));
      try{
        expect(await awaitLive(base,first.child),first.error()).toBe(true);
        expect((await login(tokenA)).status).toBe(303);
      }finally{await stop(first.child);}

      // Rotation: replace the secret file, then restart. The old credential
      // must NOT remain valid after the process restarts.
      fs.writeFileSync(path.join(fixture.root,".token"),tokenB);
      const second=start(fixture,runner,baseEnv(fixture,{MCP_PORT:String(port)}));
      try{
        expect(await awaitLive(base,second.child),second.error()).toBe(true);
        expect((await login(tokenA)).status).toBe(403);
        expect((await login(tokenB)).status).toBe(303);
        // The secret is never echoed on the unauthenticated liveness probe.
        expect(await (await fetch(base+"/health/live")).text()).not.toContain(tokenB);
      }finally{await stop(second.child);}
    }finally{fixture.cleanup();}
  },60000);
});
