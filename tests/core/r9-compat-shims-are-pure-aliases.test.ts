import fs from "node:fs";
import path from "node:path";
import {describe,expect,it} from "vitest";
import {parseRetentionDaysRaw,parseBootstrapSecret,parseHttpSecurityConfig} from "../../src/infrastructure/config/app-config.js";
import {readLegacyRetentionDays} from "../../src/infrastructure/config/legacy-retention.js";
import {readHttpBootstrapSecret,readHttpSecurityConfig,readLegacyHttpServerSettings,readLegacyHttpAccessToken} from "../../src/infrastructure/config/legacy-http-server.js";

/**
 * R9.03 — compatibility shims must be pure aliases. The R7.01 cutover left
 * several historical-name projections over the single authoritative
 * `app-config.ts` parsers so existing imports kept resolving. Those shims are
 * kept DELIBERATELY (they are the executable migration contract — four test
 * files assert the historical names still work), but they must never grow
 * hidden logic of their own: a shim with real code is dead weight that cannot
 * be removed, and a shim that duplicates a parser can drift from it.
 *
 * This test pins each shim to the alias shape and re-checks, by source scan,
 * that no shim under src/infrastructure/config/ grew a non-trivial body.
 */

const REPO=process.cwd();

function readSource(relative:string):string{
  return fs.readFileSync(path.resolve(REPO,relative),"utf8");
}

describe("R9.03 compatibility shims are pure projections",()=>{
  it("legacy-retention is a bare alias of parseRetentionDaysRaw",()=>{
    const source=readSource("src/infrastructure/config/legacy-retention.ts");
    expect(source).toContain("readLegacyRetentionDays = parseRetentionDaysRaw");
    // No parser of its own: the real logic lives in app-config.ts.
    expect(source).not.toMatch(/export function parse/);
  });

  it("legacy-http-server only re-exposes the authoritative parsers",()=>{
    const source=readSource("src/infrastructure/config/legacy-http-server.ts");
    // Every exported function is either the alias or a thin projection with no
    // parsing of its own; the retired bearer token stays hard-undefined.
    expect(source).toContain("readHttpBootstrapSecret = parseBootstrapSecret");
    expect(source).toContain("readHttpSecurityConfig = parseHttpSecurityConfig");
    expect(source).toMatch(/returns? undefined/);
    // The historical bearer-token credential is retired by construction.
    expect(source).toContain("never issued from the bootstrap secret");
  });

  it("no config shim grew a hidden parser or its own state",()=>{
    const configDir=path.resolve(REPO,"src","infrastructure","config");
    const violations:string[]=[];
    for(const entry of fs.readdirSync(configDir,{withFileTypes:true})){
      if(!entry.name.startsWith("legacy")||!entry.name.endsWith(".ts"))continue;
      const source=fs.readFileSync(path.join(configDir,entry.name),"utf8");
      // Every import statement must resolve to the authoritative app-config.ts.
      // A shim importing anything else is hiding a dependency that belongs in
      // the real module, not in a compatibility projection.
      for(const statement of source.match(/import\s+[\s\S]*?\sfrom\s+"[^"]+";/g)??[]){
        if(!statement.includes("./app-config.js"))
          violations.push(`${entry.name}: foreign import -> ${statement.trim()}`);
      }
      // process.env may appear ONLY as a default parameter value, never read
      // directly (a direct read is hidden parsing logic of its own).
      for(const line of source.split(/\r?\n/)){
        if(/process\.env/.test(line)&&!/= process\.env/.test(line))
          violations.push(`${entry.name}: reads process.env beyond a default parameter`);
      }
    }
    expect(violations,`Config shim contains real logic: ${violations.join("; ")}`).toEqual([]);
  });

  it("the historical names still resolve (migration contract is executable)",()=>{
    // The historical paths must still work AND must be the very same function
    // objects as the authoritative parsers — a cutover is only honest if the
    // alias cannot drift from the real implementation.
    expect(readLegacyRetentionDays).toBe(parseRetentionDaysRaw);
    expect(readHttpBootstrapSecret).toBe(parseBootstrapSecret);
    expect(readHttpSecurityConfig).toBe(parseHttpSecurityConfig);
    // The projection must agree with the authoritative config, and the retired
    // bearer-token credential must stay hard-undefined.
    const projected=readLegacyHttpServerSettings({MCP_HTTP_PORT:"30111",MCP_PUBLIC_BASE_URL:"http://127.0.0.1:30111"});
    const authoritative=parseHttpSecurityConfig({MCP_HTTP_PORT:"30111",MCP_PUBLIC_BASE_URL:"http://127.0.0.1:30111"});
    expect(projected).toEqual({port:authoritative.port,publicBaseUrl:authoritative.publicBaseUrl});
    expect(readLegacyHttpAccessToken({MCP_ACCESS_TOKEN:"never"})).toBeUndefined();
  });
});
