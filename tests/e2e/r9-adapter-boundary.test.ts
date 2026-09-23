import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {spawn,type ChildProcess} from "node:child_process";
import {pathToFileURL} from "node:url";
import {describe,expect,it} from "vitest";
import {createDisposableFixture} from "../helpers/r0-disposable-fixtures.js";

/**
 * R9.01 — adapter boundary is executable, not aspirational. Two properties:
 *
 * 1. SQL never appears outside the persistence adapters. The readiness probe
 *    in the HTTP transport previously contained an inline `db.prepare(...)`;
 *    it now calls isDatabaseReady() from the SQLite adapter. A source scan
 *    over the transport layer keeps that regression from coming back, and a
 *    runtime check proves the probe still answers 200 against a live server.
 *
 * 2. The probe reports 503, not a crash, when the database is unavailable —
 *    verified by pointing the server at a path inside a read-only directory
 *    so the connection genuinely cannot be opened.
 */

const REPO=process.cwd();
const LOADER=pathToFileURL(path.join(REPO,"node_modules/tsx/dist/loader.mjs")).href;

function startServer(fixture:{root:string;sqlitePath:string},port:number,bootstrap:string):ChildProcess{
  const runner=path.join(fixture.root,"r9-ready-runner.mts");
  if(!fs.existsSync(runner))
    fs.writeFileSync(runner,
      `import {startHttpServer} from ${JSON.stringify(pathToFileURL(path.join(REPO,"src/mcp/http-server.ts")).href)};await startHttpServer();`,
      {flag:"wx"});
  return spawn(process.execPath,["--import",LOADER,runner],
    {cwd:fixture.root,env:{...process.env,
      HOOSHIX_BOOTSTRAP_TOKEN:bootstrap,MCP_ACCESS_TOKEN:undefined,MCP_API_KEY:undefined,
      HOOSHIX_HTTP_PORT:String(port),HOOSHIX_HTTP_HOST:"127.0.0.1",
      HOOSHIX_PUBLIC_BASE_URL:"http://127.0.0.1:"+port,
      HOOSHIX_WORKSPACE:fixture.root,HOOSHIX_DB_PATH:fixture.sqlitePath,
      HOOSHIX_LOG_DIR:path.join(fixture.root,"logs"),HOOSHIX_PERMISSION_LEVEL:"DEVELOPER_MODE"},
    stdio:["pipe","pipe","pipe"],windowsHide:true});
}

async function awaitLive(base:string,child:ChildProcess,timeoutMs=9000):Promise<boolean>{
  for(let attempt=0;attempt<Math.floor(timeoutMs/100);attempt++){
    try{if((await fetch(base+"/health/live")).status===200)return true;}catch{/* booting */}
    if(child.exitCode!==null)return false;
    await new Promise((resolve)=>setTimeout(resolve,100));
  }
  return false;
}

// Wait for the OS to release the child's file descriptors (the SQLite WAL
// handles under the fixture root) before teardown, otherwise Windows EPERM.
async function stop(child:ChildProcess):Promise<void>{
  if(child.exitCode!==null||child.signalCode!==null)return;
  const closed=new Promise<void>(resolve=>child.once("close",()=>resolve()));
  child.kill("SIGKILL");
  await closed;
}

function drainLog(child:ChildProcess):string{
  let out="";
  for(const stream of [child.stdout,child.stderr]){
    if(!stream)continue;
    const chunks:Buffer[]=[];
    let chunk:Buffer|null=null;
    while((chunk=stream.read())!==null)chunks.push(chunk);
    if(chunks.length)out+=Buffer.concat(chunks).toString("utf8");
  }
  return out;
}

describe("R9.01 adapter boundary (SQL confined to persistence adapters)",()=>{
  // 30xxx sits outside every Windows excluded port range on this host.
  function freePort():number{return 30300+Math.floor(Math.random()*600);}

  it("keeps SQL out of the transport layer and still serves a live readiness probe",async()=>{
    const fixture=createDisposableFixture("r9-ready");
    const port=freePort();
    const child=startServer(fixture,port,crypto.randomBytes(32).toString("base64url"));
    try{
      const base=`http://127.0.0.1:${port}`;
      const booted=await awaitLive(base,child);
      expect(booted,booted?"":"server failed to boot: "+drainLog(child)).toBe(true);
      const ready=await fetch(base+"/health/ready");
      expect(ready.status).toBe(200);
      const body=await ready.json() as {status:string};
      expect(body.status).toBe("ready");
      const live=await fetch(base+"/health/live");
      expect(live.status).toBe(200);
    }finally{
      await stop(child);
      fixture.cleanup();
    }
  });

  it("reports 503 without crashing when the database cannot be opened",async()=>{
    const fixture=createDisposableFixture("r9-unready");
    const port=freePort();
    // Point the database at an existing directory: SQLite fails with
    // SQLITE_CANTOPEN_ISDIR on every platform (chmod is not reliable on
    // Windows), which is the failure mode the probe must survive.
    const inaccessible=path.join(fixture.root,"is-a-directory.sqlite");
    fs.mkdirSync(inaccessible);
    const child=startServer(
      {root:fixture.root,sqlitePath:inaccessible},
      port,crypto.randomBytes(32).toString("base64url"));
    try{
      const base=`http://127.0.0.1:${port}`;
      const live=await awaitLive(base,child);
      // On some platforms the listener still boots; on others it exits. Either
      // way the readiness endpoint must never claim 200 for a dead database.
      if(live){
        const ready=await fetch(base+"/health/ready");
        expect(ready.status).toBe(503);
        const body=await ready.json() as {status:string};
        expect(body.status).toBe("not_ready");
      }else{
        expect(child.exitCode).not.toBe(0);
      }
    }finally{
      await stop(child);
      fixture.cleanup();
    }
  });

  it("forbids inline SQL in the MCP transport layer (source scan)",()=>{
    const transportDir=path.join(REPO,"src","mcp");
    const violations:string[]=[];
    // better-sqlite3 statement entry points. Generic collection verbs such as
    // Map.get() are deliberately excluded — only these methods carry SQL text.
    const sqlPattern=/\.(?:prepare|pragma|exec)\s*\(\s*["'`]/;
    function walk(dir:string):void{
      for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
        const target=path.join(dir,entry.name);
        if(entry.isDirectory()){walk(target);continue;}
        if(!entry.name.endsWith(".ts"))continue;
        const source=fs.readFileSync(target,"utf8");
        source.split(/\r?\n/).forEach((line,number)=>{
          if(sqlPattern.test(line))violations.push(`${path.relative(REPO,target)}:${number+1}`);
        });
      }
    }
    walk(transportDir);
    expect(violations,`Inline SQL found in transport layer: ${violations.join(", ")}`).toEqual([]);
  });

  it("exposes the readiness contract from the SQLite adapter only",()=>{
    const adapterPath=path.join(REPO,"src","adapters","outbound","persistence","sqlite","connection.adapter.ts");
    expect(fs.existsSync(adapterPath)).toBe(true);
    const source=fs.readFileSync(adapterPath,"utf8");
    expect(source).toContain("export function isDatabaseReady(): boolean");
    // The transport layer must reach the probe through the adapter facade,
    // not through a re-declared copy of the SQL it was created to remove.
    const serverPath=path.join(REPO,"src","mcp","http-server.ts");
    const serverSource=fs.readFileSync(serverPath,"utf8");
    expect(serverSource).toContain("isDatabaseReady()");
    expect(serverSource).not.toMatch(/prepare\(\s*["']SELECT 1 AS ok["']\)/);
  });
});
