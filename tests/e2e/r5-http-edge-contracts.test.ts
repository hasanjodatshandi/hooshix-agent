import fs from "node:fs";
import path from "node:path";
import {spawn, type ChildProcess} from "node:child_process";
import {pathToFileURL} from "node:url";
import {describe,expect,it} from "vitest";
import {createDisposableFixture,reserveEphemeralLoopbackPort} from "../helpers/r0-disposable-fixtures.js";

describe("R5 protected HTTP edge and operator bootstrap process contracts",()=>{
  it("pins trusted issuer, bounds public requests, uses an isolated owner-only bootstrap file",async()=>{
    const fixture=createDisposableFixture("r5-secret");
    const lease=await reserveEphemeralLoopbackPort();
    const port=lease.port;
    await lease.close();
    const repo=process.cwd(),base="http://127.0.0.1:"+port;
    const runner=path.join(fixture.root,"r5-runner.mts");
    fs.writeFileSync(runner,
      `import {startHttpServer} from ${JSON.stringify(pathToFileURL(path.join(repo,"src/mcp/http-server.ts")).href)};await startHttpServer();`);
    const loader=pathToFileURL(path.join(repo,"node_modules/tsx/dist/loader.mjs")).href;
    const env:NodeJS.ProcessEnv={...process.env,
      HOOSHIX_BOOTSTRAP_TOKEN:undefined,MCP_ACCESS_TOKEN:undefined,MCP_API_KEY:undefined,
      MCP_PORT:String(port),MCP_PUBLIC_BASE_URL:base,MCP_BIND_HOST:"127.0.0.1",
      HOOSHIX_WORKSPACE:fixture.root,HOOSHIX_DB_PATH:fixture.sqlitePath,
      HOOSHIX_LOG_DIR:path.join(fixture.root,"logs"),
      HOOSHIX_PERMISSION_LEVEL:"READ_ONLY"
    };
    function start(){
      const child=spawn(process.execPath,["--import",loader,runner],
        {cwd:fixture.root,env,stdio:["pipe","pipe","pipe"],windowsHide:true});
      let errorOutput="";
      child.stderr.on("data",(part:Buffer)=>{errorOutput+=part.toString();});
      return {child,error:()=>errorOutput};
    }
    async function stop(child:ChildProcess){
      if(child.exitCode!==null||child.signalCode!==null)return;
      const closed=new Promise<void>(resolve=>child.once("close",()=>resolve()));
      child.kill();await closed;
    }
    const first=start();
    try{
      let ready=false;
      for(let attempt=0;attempt<75;attempt++){
        try{if((await fetch(base+"/health/live")).status===200){ready=true;break;}}catch{/* startup */}
        if(first.child.exitCode!==null)break;
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      expect(ready,first.error()).toBe(true);
      const tokenPath=path.join(fixture.root,".token");
      expect(fs.existsSync(tokenPath)).toBe(true);
      const operatorSecret=fs.readFileSync(tokenPath,"utf8").trim();
      expect(operatorSecret.length).toBeGreaterThanOrEqual(43);
      if(process.platform!=="win32")expect(fs.statSync(tokenPath).mode&0o077).toBe(0);
      const live=await fetch(base+"/health/live");
      expect(live.status).toBe(200);
      expect(await live.text()).not.toContain(operatorSecret);
      const readyProbe=await fetch(base+"/health/ready");
      expect(readyProbe.status).toBe(200);
      expect(await readyProbe.text()).not.toContain(operatorSecret);
      const metadata=await fetch(base+"/.well-known/oauth-authorization-server",
        {headers:{Host:"untrusted.invalid"}});
      expect(metadata.status).toBe(200);
      expect((await metadata.json() as {issuer:string}).issuer).toBe(base);
      const cors=await fetch(base+"/mcp",{method:"OPTIONS",headers:{Origin:base}});
      expect(cors.status).toBe(204);
      expect(cors.headers.get("Access-Control-Allow-Origin")).toBe(base);
      const blocked=await fetch(base+"/mcp",{method:"OPTIONS",
        headers:{Origin:"https://untrusted.invalid"}});
      expect(blocked.status).toBe(403);
      let throttled:Response|undefined;
      for(let attempt=0;attempt<95;attempt++){
        const response=await fetch(base+"/.well-known/oauth-protected-resource");
        if(response.status===429){throttled=response;break;}
      }
      expect(throttled?.status).toBe(429);
      expect(Number(throttled?.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
      await stop(first.child);
      if(process.platform!=="win32"){
        fs.chmodSync(tokenPath,0o644);
        const second=start();
        try{
          const result=await Promise.race([
            new Promise<number|null>(resolve=>second.child.once("exit",code=>resolve(code))),
            new Promise<null>(resolve=>setTimeout(()=>resolve(null),4500))
          ]);
          expect(result,second.error()).not.toBeNull();
          expect(result).not.toBe(0);
          expect(second.error()).toMatch(/insecure bootstrap secret file/);
        }finally{await stop(second.child);}
      }
    }finally{
      await stop(first.child);
      fixture.cleanup();
    }
  },30000);
});
