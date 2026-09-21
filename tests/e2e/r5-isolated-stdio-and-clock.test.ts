import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {pathToFileURL} from "node:url";
import {Client} from "@modelcontextprotocol/client";
import {StdioClientTransport} from "@modelcontextprotocol/client/stdio";
import {describe,expect,it} from "vitest";
import {createDisposableFixture} from "../helpers/r0-disposable-fixtures.js";

describe("R5 isolated modern stdio and fake-clock process acceptance",()=>{
  it("negotiates the 2026 MCP protocol with the v2 stdio client against a disposable process",async()=>{
    const fixture=createDisposableFixture("r5-stdio");
    const repo=process.cwd();
    const env=Object.fromEntries(Object.entries({...process.env,
      HOOSHIX_DB_PATH:fixture.sqlitePath,
      HOOSHIX_LOG_DIR:path.join(fixture.root,"logs"),
      HOOSHIX_MEMORY_FILE:path.join(fixture.root,"memory.json"),
      HOOSHIX_WORKSPACE:fixture.root,
      HOOSHIX_PERMISSION_LEVEL:"READ_ONLY",
      HOOSHIX_BOOTSTRAP_TOKEN:undefined,MCP_ACCESS_TOKEN:undefined,MCP_API_KEY:undefined
    }).filter((entry):entry is [string,string]=>entry[1]!==undefined));
    const transport=new StdioClientTransport({
      command:process.execPath,
      args:[path.join(repo,"node_modules","tsx","dist","cli.mjs"),path.join(repo,"src","index.ts")],
      cwd:fixture.root,env,stderr:"pipe"
    });
    const client=new Client({name:"r5-modern-stdio-test",version:"1"},{
      versionNegotiation:{mode:{pin:"2026-07-28"}}
    });
    try{
      await client.connect(transport);
      expect(client.getProtocolEra()).toBe("modern");
      const listed=await client.listTools();
      expect(listed.tools.some(tool=>tool.name==="get_workspace")).toBe(true);
      expect(listed.tools.some(tool=>tool.name==="task_run")).toBe(true);
      expect(fs.existsSync(fixture.sqlitePath)).toBe(true);
    }finally{
      await client.close().catch(()=>{});
      fixture.cleanup();
    }
  },30000);

  it("verifies PKCE, expiry, audience, rotation and replay in a separate fake-clock process",()=>{
    const fixture=createDisposableFixture("r5-clock");
    const repo=process.cwd();
    const runner=path.join(fixture.root,"r5-fake-clock.mts");
    const oauthUrl=pathToFileURL(path.join(repo,"src","mcp","oauth.ts")).href;
    fs.writeFileSync(runner,`
      import assert from "node:assert/strict";
      import crypto from "node:crypto";
      import {OAuthProvider} from ${JSON.stringify(oauthUrl)};
      let now=Date.parse("2026-09-21T00:00:00.000Z");
      const resource="http://127.0.0.1:12345/mcp";
      const provider=new OAuthProvider("fixture-isolated-operator-secret-not-a-token",{now:()=>now});
      const verifier=crypto.randomBytes(32).toString("base64url");
      const challenge=crypto.createHash("sha256").update(verifier).digest("base64url");
      const redirect="http://127.0.0.1:54321/return",client="fixture-client";
      try{
        const expired=provider.issueCode(challenge,resource,redirect,client);
        now+=300001;
        assert.equal(provider.exchange(expired,verifier,resource,redirect,client),null);
        const invalid=provider.issueCode(challenge,resource,redirect,client);
        assert.equal(provider.exchange(invalid,"incorrect",resource,redirect,client),null);
        assert.equal(provider.exchange(invalid,verifier,resource,redirect,client),null);
        const valid=provider.issueCode(challenge,resource,redirect,client);
        const token=provider.exchange(valid,verifier,resource,redirect,client);
        assert.ok(token);
        assert.equal(provider.verifyToken("Bearer "+token.access_token,resource),true);
        assert.equal(provider.verifyToken("Bearer "+token.access_token,resource+"/other"),false);
        now+=3600001;
        assert.equal(provider.verifyToken("Bearer "+token.access_token,resource),false);
        const rotated=provider.refresh(token.refresh_token,resource,client);
        assert.ok(rotated);
        assert.equal(provider.verifyToken("Bearer "+rotated.access_token,resource),true);
        assert.equal(provider.refresh(token.refresh_token,resource,client),null);
        assert.equal(provider.verifyToken("Bearer "+rotated.access_token,resource),false);
        console.log(JSON.stringify({expiredCode:true,oneTimePkce:true,audienceBound:true,
          accessExpired:true,refreshRotated:true,replayRevoked:true}));
      }finally{provider.destroy();}
    `,{flag:"wx"});
    const result=spawnSync(process.execPath,["--import",
      pathToFileURL(path.join(repo,"node_modules","tsx","dist","loader.mjs")).href,runner],{
      cwd:fixture.root,encoding:"utf8",timeout:12000,maxBuffer:65536,windowsHide:true,
      env:{...process.env,HOOSHIX_DB_PATH:fixture.sqlitePath,
        HOOSHIX_LOG_DIR:path.join(fixture.root,"logs"),
        HOOSHIX_WORKSPACE:fixture.root,MCP_ACCESS_TOKEN:undefined,MCP_API_KEY:undefined}
    });
    try{
      expect(result.status,result.stderr||result.error?.message).toBe(0);
      expect(JSON.parse(result.stdout.trim())).toEqual({
        expiredCode:true,oneTimePkce:true,audienceBound:true,
        accessExpired:true,refreshRotated:true,replayRevoked:true
      });
    }finally{fixture.cleanup();}
  },20000);
});
