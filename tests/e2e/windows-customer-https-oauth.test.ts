import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import tls from "node:tls";
import {spawn,spawnSync, type ChildProcess} from "node:child_process";
import {pathToFileURL} from "node:url";
import {describe,expect,it} from "vitest";
import {Client,StreamableHTTPClientTransport} from "@modelcontextprotocol/client";
import {createDisposableFixture,reserveEphemeralLoopbackPort} from "../helpers/r0-disposable-fixtures.js";

/**
 * A customer-facing HTTPS/OAuth/MCP handshake behind a real TLS-terminating
 * reverse proxy, all bound to 127.0.0.1 and backed by disposable SQLite.
 *
 * Explicitly does NOT claim real public DNS, third-party ChatGPT app
 * registration, customer internet routing or browser UX.
 * The test trusts ONLY its newly generated localhost certificate and keeps
 * ordinary TLS hostname verification enabled; no NODE_TLS_REJECT_UNAUTHORIZED=0.
 */
function opensslBinary():string{
  if(process.platform!=="win32")return "openssl";
  const roots=[process.env.ProgramFiles??"C:\\Program Files",process.env["ProgramFiles(x86)"]??"C:\\Program Files (x86)"];
  const found=roots.flatMap(root=>[
    path.join(root,"Git","usr","bin","openssl.exe"),
    path.join(root,"Git","mingw64","bin","openssl.exe"),
  ]).find(item=>fs.existsSync(item));
  if(!found)throw new Error("OpenSSL from Git for Windows is required for HTTPS E2E on Windows");
  return found;
}
function tlsCert(root:string){
  const key=path.join(root,"localhost.key.pem");
  const cert=path.join(root,"localhost.cert.pem");
  const result=spawnSync(opensslBinary(),[
    "req","-x509","-newkey","rsa:2048","-sha256","-nodes",
    "-keyout",key,"-out",cert,"-days","1",
    "-subj","/CN=localhost","-addext","subjectAltName=DNS:localhost,IP:127.0.0.1",
  ],{cwd:root,encoding:"utf8",windowsHide:true,timeout:12_000});
  if(result.status!==0)throw new Error("Ephemeral test certificate generation failed: "+(result.stderr??result.error?.message));
  return {key:fs.readFileSync(key),cert:fs.readFileSync(cert,"utf8")};
}
function closeServer(server:https.Server){
  return new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
}
async function stopChild(child:ChildProcess){
  if(child.exitCode!==null||child.signalCode!==null)return;
  const closed=new Promise<void>(resolve=>child.once("close",()=>resolve()));
  child.kill();
  await closed;
}
describe("Customer HTTPS / OAuth / MCP onboarding, isolated loopback",()=>{
  it("authenticates a read-only client through locally trusted TLS and refuses higher scopes",async()=>{
    const fixture=createDisposableFixture("customer-tls");
    const priorTrust=tls.getCACertificates("default");
    let reverseProxy:https.Server|undefined;
    let backend:ChildProcess|undefined;
    const cert=tlsCert(fixture.root);
    tls.setDefaultCACertificates([...priorTrust,cert.cert]);
    try{
      const lease=await reserveEphemeralLoopbackPort();
      const localPort=lease.port;
      await lease.close();
      const proxyPort=await reserveEphemeralLoopbackPort();
      await proxyPort.close();
      const publicOrigin="https://127.0.0.1:"+proxyPort.port;
      const bootstrap="ISOLATED_ONLY_"+crypto.randomBytes(32).toString("hex");
      reverseProxy=https.createServer({key:cert.key,cert:cert.cert},(req,res)=>{
        const forwarded=http.request({
          hostname:"127.0.0.1",port:localPort,
          path:req.url,method:req.method,
          headers:{...req.headers,host:"127.0.0.1:"+localPort}
        },response=>{
          res.writeHead(response.statusCode??502,response.headers);
          response.pipe(res);
        });
        forwarded.on("error",()=>{if(!res.headersSent)res.writeHead(502);res.end();});
        req.pipe(forwarded);
      });
      await new Promise<void>((resolve,reject)=>{
        reverseProxy!.once("error",reject);
        reverseProxy!.listen(proxyPort.port,"127.0.0.1",resolve);
      });

      const repo=process.cwd();
      const runner=path.join(fixture.root,"customer-http-runner.mts");
      fs.writeFileSync(runner,`import {startHttpServer} from ${JSON.stringify(pathToFileURL(path.join(repo,"src/mcp/http-server.ts")).href)};await startHttpServer();`,{flag:"wx"});
      const loader=pathToFileURL(path.join(repo,"node_modules/tsx/dist/loader.mjs")).href;
      backend=spawn(process.execPath,["--import",loader,runner],{
        cwd:repo,windowsHide:true,stdio:["pipe","pipe","pipe"],
        env:{...process.env,
          HOOSHIX_DB_PATH:fixture.sqlitePath,HOOSHIX_LOG_DIR:path.join(fixture.root,"logs"),
          HOOSHIX_WORKSPACE:fixture.root,HOOSHIX_BOOTSTRAP_TOKEN:bootstrap,
          HOOSHIX_PUBLIC_BASE_URL:undefined,MCP_PUBLIC_BASE_URL:publicOrigin,
          MCP_BIND_HOST:"127.0.0.1",MCP_PORT:String(localPort),
          MCP_API_KEY:undefined,MCP_ACCESS_TOKEN:undefined,
          HOOSHIX_PERMISSION_LEVEL:"READ_ONLY"}
      });
      let backendErrors="";
      backend.stderr?.on("data",(chunk:Buffer)=>{backendErrors+=chunk.toString();});
      let running=false;
      for(let attempt=0;attempt<100;attempt++){
        try{if((await fetch(publicOrigin+"/health/live")).status===200){running=true;break;}}catch{}
        if(backend.exitCode!==null)break;
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      expect(running,backendErrors.slice(-1000)).toBe(true);
      const resource=publicOrigin+"/mcp";
      const metadata=await fetch(publicOrigin+"/.well-known/oauth-protected-resource");
      expect(metadata.status).toBe(200);
      expect((await metadata.json() as {resource:string}).resource).toBe(resource);
      const authMeta=await fetch(publicOrigin+"/.well-known/oauth-authorization-server");
      expect(authMeta.status).toBe(200);
      expect((await authMeta.json() as {issuer:string}).issuer).toBe(publicOrigin);
      const blocked=await fetch(publicOrigin+"/mcp",{method:"OPTIONS",
        headers:{Origin:"https://attacker.invalid"}});
      expect(blocked.status).toBe(403);

      const redirect="http://127.0.0.1:49995/callback";
      const registration=await fetch(publicOrigin+"/oauth/register",{method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({redirect_uris:[redirect]})});
      expect(registration.status).toBe(201);
      const clientId=(await registration.json() as {client_id:string}).client_id;
      const verifier=crypto.randomBytes(32).toString("base64url");
      const challenge=crypto.createHash("sha256").update(verifier).digest("base64url");
      const auth=await fetch(publicOrigin+"/oauth/authorize",{method:"POST",redirect:"manual",
        body:new URLSearchParams({response_type:"code",client_id:clientId,redirect_uri:redirect,
          resource,scope:"offline_access hooshix:read",code_challenge:challenge,
          code_challenge_method:"S256",pin:bootstrap,grant_read:"yes"})});
      expect(auth.status).toBe(302);
      const code=new URL(auth.headers.get("location")!).searchParams.get("code");
      expect(code).toBeTruthy();
      const exchange=await fetch(publicOrigin+"/oauth/token",{method:"POST",
        body:new URLSearchParams({grant_type:"authorization_code",code:code!,
          code_verifier:verifier,client_id:clientId,resource,redirect_uri:redirect})});
      expect(exchange.status).toBe(200);
      const token=await exchange.json() as {access_token:string;scope:string};
      expect(token.access_token).not.toBe(bootstrap);
      expect(token.scope.split(" ")).toContain("hooshix:read");
      const wrongBearer=await fetch(resource,{method:"POST",headers:{Authorization:"Bearer "+bootstrap}});
      expect(wrongBearer.status).toBe(401);

      const client=new Client({name:"isolated-https-customer",version:"1"},{
        versionNegotiation:{mode:{pin:"2026-07-28"}}
      });
      const transport=new StreamableHTTPClientTransport(new URL(resource),{
        requestInit:{headers:{Authorization:"Bearer "+token.access_token}}
      });
      try{
        await client.connect(transport);
        const all=await client.listTools();
        expect(all.tools.some(t=>t.name==="get_system_info")).toBe(true);
        expect(all.tools.length).toBe(58);
        const info=await client.callTool({name:"get_system_info",arguments:{}});
        expect(info.isError).not.toBe(true);
        const unauthorized=await client.callTool({name:"create_file",
          arguments:{path:"must-not-exist.txt",content:"not authorized"}});
        expect(unauthorized.isError).toBe(true);
        expect(fs.existsSync(path.join(fixture.root,"must-not-exist.txt"))).toBe(false);
      }finally{await client.close();}
    }finally{
      tls.setDefaultCACertificates(priorTrust);
      if(backend)await stopChild(backend);
      if(reverseProxy)await closeServer(reverseProxy);
      fixture.cleanup();
    }
  },55_000);
});
