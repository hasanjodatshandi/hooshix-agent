import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {spawn} from "node:child_process";
import {pathToFileURL} from "node:url";
import {describe,expect,it} from "vitest";
import {Client,StreamableHTTPClientTransport} from "@modelcontextprotocol/client";
import {createDisposableFixture,reserveEphemeralLoopbackPort} from "../helpers/r0-disposable-fixtures.js";

describe("R5 HTTP/OAuth protected process, 2026 MCP compatibility",()=>{
  it("isolates bootstrap from bearer and enforces metadata, scope, expiry, query/CORS and modern MCP",async()=>{
    const fixture=createDisposableFixture("r5-http");
    const lease=await reserveEphemeralLoopbackPort();
    const port=lease.port;await lease.close();
    const repo=process.cwd();
    const runner=path.join(fixture.root,"r5-http-runner.mts");
    fs.writeFileSync(runner,`import {startHttpServer} from ${JSON.stringify(pathToFileURL(path.join(repo,"src/mcp/http-server.ts")).href)};await startHttpServer();`);
    const bootstrap="R5_TEST_OPERATOR_SECRET_"+crypto.randomBytes(32).toString("hex");
    const base="http://127.0.0.1:"+port;
    const resource=base+"/mcp";
    const child=spawn(process.execPath,["--import",pathToFileURL(path.join(repo,"node_modules/tsx/dist/loader.mjs")).href,runner],{
      cwd:repo,env:{...process.env,MCP_PORT:String(port),MCP_BIND_HOST:"127.0.0.1",
        MCP_PUBLIC_BASE_URL:base,HOOSHIX_BOOTSTRAP_TOKEN:bootstrap,
        HOOSHIX_WORKSPACE:fixture.root,HOOSHIX_DB_PATH:path.join(fixture.root,"db","agent.sqlite"),
        HOOSHIX_LOG_DIR:path.join(fixture.root,"logs"),HOOSHIX_PERMISSION_LEVEL:"DEVELOPER_MODE",
        MCP_ACCESS_TOKEN:undefined,MCP_API_KEY:undefined},
      stdio:["pipe","pipe","pipe"],windowsHide:true
    });
    let stderr="";
    child.stderr.on("data",(chunk:Buffer)=>{stderr+=chunk.toString();});
    const poll=async()=>{
      for(let i=0;i<70;i++){
        try{if((await fetch(base+"/health/live")).status===200)return true;}catch{/* booting */}
        if(child.exitCode!==null)return false;
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      return false;
    };
    const plain=(uri:string,init?:RequestInit)=>fetch(base+uri,init);
    const pkce=()=>{
      const verifier=crypto.randomBytes(32).toString("base64url");
      return {verifier,challenge:crypto.createHash("sha256").update(verifier).digest("base64url")};
    };
    async function token(scopes:string,grants:Record<string,string>={}){
      const {verifier,challenge}=pkce();
      const redirect="http://127.0.0.1:49991/callback";
      const registration=await plain("/oauth/register",{method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({redirect_uris:[redirect]})});
      expect(registration.status).toBe(201);
      const clientId=(await registration.json() as {client_id:string}).client_id;
      const data=new URLSearchParams({response_type:"code",client_id:clientId,redirect_uri:redirect,
        resource,scope:scopes,code_challenge:challenge,code_challenge_method:"S256",pin:bootstrap,...grants});
      const auth=await plain("/oauth/authorize",{method:"POST",body:data,redirect:"manual"});
      expect(auth.status).toBe(302);
      const code=new URL(auth.headers.get("location")!).searchParams.get("code")!;
      const exchange=await plain("/oauth/token",{method:"POST",body:new URLSearchParams({
        grant_type:"authorization_code",code,code_verifier:verifier,redirect_uri:redirect,
        client_id:clientId,resource
      })});
      expect(exchange.status).toBe(200);
      return {...(await exchange.json() as {access_token:string;refresh_token:string;expires_in:number;scope:string}),clientId};
    }
    try{
      expect(await poll(),stderr).toBe(true);
      const live=await plain("/health/live");expect(live.status).toBe(200);
      expect(JSON.stringify(await live.json())).not.toContain(bootstrap);
      const meta=await plain("/.well-known/oauth-protected-resource");
      expect(meta.status).toBe(200);
      expect((await meta.json()).resource).toBe(resource);
      const offlineOnly=await token("offline_access");
      expect(offlineOnly.scope).toBe("offline_access");
      const operatorApproved=await token("offline_access",{
        grant_read:"yes",grant_workspace:"yes",grant_tasks:"yes",
        grant_write:"yes",grant_execute:"yes"
      });
      expect(operatorApproved.scope.split(" ")).toEqual([
        "offline_access","hooshix:read","hooshix:workspace:manage",
        "hooshix:task:manage","hooshix:project:write","hooshix:execute"
      ]);
      async function workspaceResult(accessToken:string,name:string){
        const actor=new Client({name,version:"1"},{versionNegotiation:{mode:{pin:"2026-07-28"}}});
        const link=new StreamableHTTPClientTransport(new URL(resource),{
          requestInit:{headers:{Authorization:"Bearer "+accessToken}}
        });
        try{
          await actor.connect(link);
          return await actor.callTool({name:"get_workspace",arguments:{}});
        }finally{await actor.close();}
      }
      const deniedWorkspace=await workspaceResult(offlineOnly.access_token,"offline-only");
      expect(deniedWorkspace.isError).toBe(true);
      expect(JSON.stringify(deniedWorkspace)).toContain("principal_scope_insufficient");
      const grantedWorkspace=await workspaceResult(operatorApproved.access_token,"explicit-consent");
      expect(grantedWorkspace.isError).not.toBe(true);
      const issued=await token("offline_access hooshix:read");
      const consent=await plain("/oauth/authorize?"+new URLSearchParams({
        response_type:"code",client_id:issued.clientId,
        redirect_uri:"http://127.0.0.1:49991/callback",resource,
        code_challenge:pkce().challenge,code_challenge_method:"S256",scope:"offline_access hooshix:read"
      }));
      expect(consent.status).toBe(200);
      // Real Chrome form POSTs send Origin:null if the consent HTML has no-referrer.
      expect(consent.headers.get("referrer-policy")).toBe("same-origin");
      const consentForm=new URLSearchParams({
        pin:"incorrect_operator_secret",redirect_uri:"http://127.0.0.1:49991/callback",
        client_id:issued.clientId,resource,response_type:"code",code_challenge:pkce().challenge,
        code_challenge_method:"S256",scope:"offline_access hooshix:read"
      });
      const allowed=await plain("/oauth/authorize",{method:"POST",headers:{Origin:base},body:consentForm});
      expect(allowed.status).toBe(403);
      expect(await allowed.text()).toContain("کلید اشتباه است");
      const blocked=await plain("/oauth/authorize",{method:"POST",headers:{Origin:"https://attacker.invalid"},body:consentForm});
      expect(blocked.status).toBe(403);
      expect((await blocked.json()).error).toBe("origin_not_allowed");
      expect(issued.access_token).not.toBe(bootstrap);
      expect(issued.expires_in).toBe(3600);
      expect((await plain("/mcp",{method:"POST",headers:{Authorization:"Bearer "+bootstrap}})).status).toBe(401);
      expect((await plain("/mcp?token="+encodeURIComponent(issued.access_token),{
        method:"POST",headers:{Authorization:"Bearer "+issued.access_token}})).status).toBe(400);
      expect((await plain("/metrics?token="+encodeURIComponent(issued.access_token))).status).toBe(400);
      expect((await plain("/metrics",{headers:{Authorization:"Bearer "+issued.access_token}})).status).toBe(403);
      expect((await plain("/dashboard",{headers:{Authorization:"Bearer "+issued.access_token}})).status).toBe(403);
      expect((await plain("/mcp",{method:"OPTIONS",headers:{Origin:"https://attacker.invalid"}})).status).toBe(403);
      const bearer="Bearer "+issued.access_token;
      const client=new Client({name:"r5-modern-fixture",version:"1"},{
        versionNegotiation:{mode:{pin:"2026-07-28"}}
      });
      const transport=new StreamableHTTPClientTransport(new URL(resource),{
        requestInit:{headers:{Authorization:bearer}}
      });
      try{
        await client.connect(transport);
        expect(client.getProtocolEra()).toBe("modern");
        const listed=await client.listTools();
        expect(listed.tools.some(t=>t.name==="get_workspace")).toBe(true);
      }finally{await client.close();}
      const valid=await plain("/oauth/token",{method:"POST",body:new URLSearchParams({
        grant_type:"refresh_token",refresh_token:issued.refresh_token,resource,client_id:issued.clientId
      })});
      expect(valid.status).toBe(200);
      const rotated=await valid.json() as {access_token:string;refresh_token:string};
      expect(rotated.access_token).not.toBe(issued.access_token);
      const replay=await plain("/oauth/token",{method:"POST",body:new URLSearchParams({
        grant_type:"refresh_token",refresh_token:issued.refresh_token,resource,client_id:issued.clientId
      })});
      expect(replay.status).toBe(400);
      expect((await plain("/mcp",{method:"POST",headers:{Authorization:"Bearer "+rotated.access_token}})).status).toBe(401);
    }finally{
      if(child.exitCode===null){
        const closed=new Promise<void>(resolve=>child.once("close",()=>resolve()));
        child.kill();await closed;
      }
      fixture.cleanup();
    }
  },30000);
});