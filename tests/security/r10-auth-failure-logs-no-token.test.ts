import {spawn,type ChildProcessByStdio} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type {Readable} from "node:stream";
import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {createDisposableFixture} from "../helpers/r0-disposable-fixtures.js";

/**
 * Checklist item 10.6 — "HTTP auth/session failures logged safely without
 * headers/cookies/tokens". The HTTP server's failure paths return 401/403
 * without ever echoing the rejected credential into the response body or the
 * process's own error output. A failure path that prints the offending header
 * would write the secret to the operator's logs, which is how a 401 becomes a
 * leak.
 *
 * This test starts the real HTTP server, sends it a malformed/unknown bearer
 * token, and inspects BOTH the response body and everything the child process
 * wrote to stderr for the token string.
 */

const BOOTSTRAP_SECRET="operator-secret-for-log-leak-probe-0123456789";

describe("10.6 auth-failure logging leaks no token",()=>{
  const fixture=createDisposableFixture("r10-auth-log");
  let child:ChildProcessByStdio<null,Readable,Readable>;
  let base:string;
  const captured:string[]=[];
  const tokenFile=path.resolve(fixture.root,".token");

  beforeAll(async()=>{
    fs.writeFileSync(tokenFile,BOOTSTRAP_SECRET,{flag:"wx"});
    const port=30300+Math.floor(Math.random()*600);
    base=`http://127.0.0.1:${port}`;
    child=spawn(process.execPath,[path.resolve("dist/index-http.js")],{
      cwd:process.cwd(),
      env:{
        ...process.env,
        HOOSHIX_BOOTSTRAP_TOKEN_FILE:tokenFile,
        HOOSHIX_HTTP_PORT:String(port),
        HOOSHIX_HTTP_HOST:"127.0.0.1",
        HOOSHIX_DB_PATH:fixture.sqlitePath,
        HOOSHIX_LOG_DIR:path.join(fixture.root,"logs"),
        HOOSHIX_WORKSPACE:fixture.root,
      },
      windowsHide:true,
      stdio:["ignore","pipe","pipe"],
    });
    child.stdout.on("data",d=>captured.push(String(d)));
    child.stderr.on("data",d=>captured.push(String(d)));
    // Wait for liveness.
    for(let attempt=0;attempt<90;attempt++){
      try{if((await fetch(base+"/health/live")).status===200)break;}catch{/* booting */}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
  },30000);

  afterAll(async()=>{
    if(child.exitCode===null&&child.signalCode===null){
      const closed=new Promise<void>(resolve=>child.once("close",()=>resolve()));
      child.kill("SIGKILL");
      await closed;
    }
  });

  it("a rejected bearer token never appears in the response or the logs",async()=>{
    const attackerToken="hx_attacker-supplied-garbage-token-value";
    const responses:string[]=[];
    // Every failure path that sees the credential.
    for(const [target,init] of [
      ["/mcp",{method:"POST",headers:{Authorization:`Bearer ${attackerToken}`}}],
      ["/mcp",{method:"POST",headers:{Authorization:`Bearer ${BOOTSTRAP_SECRET}`}}],
      ["/mcp",{method:"POST",headers:{Authorization:"Bearer "}}],
      ["/metrics",{headers:{Authorization:`Bearer ${attackerToken}`}}],
      ["/dashboard",{headers:{Authorization:`Bearer ${attackerToken}`}}],
    ] as const){
      const response=await fetch(base+target,init as RequestInit);
      const body=await response.text();
      responses.push(`${response.status} ${body}`);
      expect(body,`${target} echoed the credential`).not.toContain(attackerToken);
      expect(body,`${target} echoed the bootstrap secret`).not.toContain(BOOTSTRAP_SECRET);
    }
    // The process's own stderr/stdout must not print the rejected header.
    const logText=captured.join("");
    expect(logText,"the server logged the attacker token").not.toContain(attackerToken);
    expect(logText,"the server logged the bootstrap secret").not.toContain(BOOTSTRAP_SECRET);
  },20000);
});
