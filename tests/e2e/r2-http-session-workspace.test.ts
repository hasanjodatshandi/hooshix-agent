import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { createDisposableFixture, reserveEphemeralLoopbackPort } from "../helpers/r0-disposable-fixtures.js";

function parseRpc(text:string):any {
  if (text.trimStart().startsWith("{")) return JSON.parse(text);
  const event = text.split(/\r?\n/).find(line=>line.startsWith("data:"));
  if (!event) throw new Error("MCP response missing JSON-RPC body");
  return JSON.parse(event.slice("data:".length).trim());
}
describe("R2.04 HTTP transport session-scoped real workspace",()=>{
  it("keeps two real HTTP MCP clients isolated across tool calls",async()=>{
    const fixture=createDisposableFixture("r2-http");
    const portLease=await reserveEphemeralLoopbackPort();
    const port=portLease.port;
    await portLease.close();
    const a=path.join(fixture.root,"workspace-a"),b=path.join(fixture.root,"workspace-b");
    fs.mkdirSync(a);fs.mkdirSync(b);
    fs.writeFileSync(path.join(a,"proof.txt"),"A-only");
    fs.writeFileSync(path.join(b,"proof.txt"),"B-only");
    const repo=process.cwd();
    const runner=path.join(fixture.root,"http-runner.mts");
    fs.writeFileSync(runner,`import { startHttpServer } from ${JSON.stringify(pathToFileURL(path.join(repo,"src/mcp/http-server.ts")).href)};\nawait startHttpServer();\n`);
    const accessToken="R2_ONLY_SYNTHETIC_HTTP_TOKEN";
    // Invoke tsx as a Node import in this process: the tsx CLI may fork a
    // second Node process that survives killing the wrapper and locks the fixture DB.
    const tsxLoader=pathToFileURL(path.join(repo,"node_modules/tsx/dist/loader.mjs")).href;
    const child=spawn(process.execPath,["--import",tsxLoader,runner],{
      // The child must not hold its temporary fixture directory as its cwd on Windows;
      // node/tsx cleanup can retain a directory handle briefly after process close.
      // All runtime DB/log/workspace paths remain explicitly isolated below.
      cwd:repo,
      env:{...process.env,MCP_PORT:String(port),MCP_ACCESS_TOKEN:accessToken,
        HOOSHIX_WORKSPACE:[a,b].join(","),HOOSHIX_DB_PATH:path.join(fixture.root,"db","agent.sqlite"),
        HOOSHIX_LOG_DIR:path.join(fixture.root,"logs"),HOOSHIX_PERMISSION_LEVEL:"DEVELOPER_MODE"},
      stdio:["pipe","pipe","pipe"],windowsHide:true,
    });
    const base=`http://127.0.0.1:${port}/mcp`;
    const requestHeaders={authorization:`Bearer ${accessToken}`,"content-type":"application/json",accept:"application/json, text/event-stream"};
    let seq=0;
    async function rpc(method:string,params:unknown,session?:string){
      const response=await fetch(base,{method:"POST",headers:{...requestHeaders,...(session?{"mcp-session-id":session}:{})},
        body:JSON.stringify({jsonrpc:"2.0",id:++seq,method,params})});
      const body=parseRpc(await response.text());
      if(!response.ok || body.error)throw Error(`RPC ${method}: HTTP ${response.status} ${JSON.stringify(body.error??body)}`);
      return {session:response.headers.get("mcp-session-id"),result:body.result};
    }
    async function tool(session:string,name:string,args:Record<string,unknown>={}){
      const r=await rpc("tools/call",{name,arguments:args},session);
      if(r.result?.isError)throw Error(JSON.stringify(r.result));
      const text=r.result.content[0].text as string;
      return /^[\\s]*[\\[{]/.test(text) ? JSON.parse(text) : text;
    }
    try {
      const healthy=async()=>{try{return (await fetch(`http://127.0.0.1:${port}/health`,{headers:{authorization:requestHeaders.authorization}})).status===200}catch{return false}};
      let ready=false;
      for(let tries=0;tries<60;tries++){if(await healthy()){ready=true;break}
        if(child.exitCode!==null)break;
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      expect(ready).toBe(true);
      const one=await rpc("initialize",{protocolVersion:"2025-06-18",capabilities:{},clientInfo:{name:"fixture-a",version:"1"}});
      const two=await rpc("initialize",{protocolVersion:"2025-06-18",capabilities:{},clientInfo:{name:"fixture-b",version:"1"}});
      const s1=one.session!,s2=two.session!;
      expect(s1).toBeTruthy();expect(s2).toBeTruthy();expect(s1).not.toBe(s2);
      await tool(s1,"set_workspace",{path:a});
      await tool(s2,"set_workspace",{path:b});
      const [w1,w2]=await Promise.all([tool(s1,"get_workspace"),tool(s2,"get_workspace")]);
      expect(w1.active.toLowerCase()).toBe(fs.realpathSync(a).toLowerCase());
      expect(w2.active.toLowerCase()).toBe(fs.realpathSync(b).toLowerCase());
      const [readA,readB]=await Promise.all([tool(s1,"read_file",{path:"proof.txt"}),tool(s2,"read_file",{path:"proof.txt"})]);
      // read_file returns text/plain in MCP content, not a JSON object.
      expect(readA).toBe("A-only");
      expect(readB).toBe("B-only");
    } finally {
      if(child.exitCode===null) {
        const closed=new Promise<void>(resolve=>child.once("close",()=>resolve()));
        child.kill();
        await closed;
      }
      fixture.cleanup();
    }
  },30000);
});