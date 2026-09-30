import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * R1 target-tree dependency guard. TypeScript 7.0.2 in this project's
 * installation does not expose the legacy createSourceFile JS API, so the
 * executable rule is a conservative static-source check plus independent
 * TypeScript compilation (tsconfig.r1.json). It is NOT an AST parser.
 */
const sourceRoot = path.resolve("src");
const newRoots = ["domain","application","adapters","infrastructure","bootstrap"];
// R-P16: the MCP SDK quarantine is repo-wide, not just for the R1 target
// trees. The SDK is permitted only in the MCP transport boundary itself —
// src/mcp/ and adapters/inbound/mcp/ — so domain/application/core can never
// grow a hard dependency on the transport framework.
function sdkAllowedHere(rel: string): boolean {
  return rel.startsWith("adapters/inbound/mcp/") || rel.startsWith("mcp/");
}
function walk(dir:string):string[] {
 if(!fs.existsSync(dir))return [];
 return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{
   const p=path.join(dir,e.name);
   return e.isDirectory()?walk(p):e.isFile()&&/\.[cm]?tsx?$/.test(e.name)?[p]:[];
 });
}
export function scanR1File(file:string,code:string):string[] {
 const rel=path.relative(sourceRoot,file).replace(/\\/g,"/");
 const domain=rel.startsWith("domain/"), app=rel.startsWith("application/"), inbound=rel.startsWith("adapters/inbound/");
 if(!newRoots.some(r=>rel.startsWith(r+"/")))return [];
 const errors:string[]=[];
 const target=(specifier:string)=>specifier.startsWith(".")?path.posix.normalize(path.posix.join(path.posix.dirname(rel),specifier)):specifier;
 const check=(specifier:string)=>{
   const t=target(specifier);
   if(domain && !t.startsWith("domain/"))errors.push(rel+": domain outward import "+specifier);
   if(app && !t.startsWith("domain/")&&!t.startsWith("application/"))errors.push(rel+": application outward import "+specifier);
   if(inbound && t.startsWith("adapters/outbound/"))errors.push(rel+": inbound to outbound "+specifier);
    if(!rel.startsWith("adapters/inbound/mcp/")&&specifier.startsWith("@modelcontextprotocol/"))errors.push(rel+": MCP outside inbound adapter "+specifier);
 };
 const imports=[
  ...code.matchAll(/\b(?:import|export)\s+(?:(?:type\s+)?[\s\S]*?\s+from\s+)?["']([^"']+)["']/g),
  ...code.matchAll(/\b(?:require|import)\s*\(\s*["']([^"']+)["']\s*\)/g),
 ];
 for(const match of imports)check(match[1]);
 if((domain||app)&&/\bprocess\s*\.\s*env\b/.test(code))errors.push(rel+": process.env outside config/bootstrap");
 if(!rel.startsWith("adapters/outbound/persistence/sqlite/") &&
   /["'`]\s*(?:SELECT\s+.+\s+FROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE)\b/i.test(code))
   errors.push(rel+": raw SQL outside sqlite adapter");
 return errors;
}

describe("G1 new-tree dependency boundaries",()=>{
  it("rejects forbidden dependencies, runtime environment access and raw SQL",()=>{
    expect(scanR1File(path.join(sourceRoot,"domain/probe.ts"),'import fs from "node:fs";')).not.toEqual([]);
    expect(scanR1File(path.join(sourceRoot,"application/probe.ts"),'const x = process.env.X;')).not.toEqual([]);
    expect(scanR1File(path.join(sourceRoot,"application/probe.ts"),'db.exec("SELECT a FROM tasks");')).not.toEqual([]);
    expect(scanR1File(path.join(sourceRoot,"adapters/inbound/mcp/probe.ts"),'import x from "../../outbound/sqlite.js";')).not.toEqual([]);
    // H5: the guard must match the real package scope (@modelcontextprotocol/),
    // not the removed v1 "@modelcontextprotocol/sdk" literal it previously
    // tested for — otherwise it never fired and any module could import the SDK.
    expect(scanR1File(path.join(sourceRoot,"application/probe.ts"),'import x from "@modelcontextprotocol/server";')).not.toEqual([]);
    expect(scanR1File(path.join(sourceRoot,"infrastructure/probe.ts"),'import x from "@modelcontextprotocol/node";')).not.toEqual([]);
    expect(scanR1File(path.join(sourceRoot,"adapters/inbound/mcp/bridge.ts"),'import x from "@modelcontextprotocol/server";')).toEqual([]);
  });
  it("scans every currently present target-tree source file",()=>{
    const files=newRoots.flatMap(root=>walk(path.join(sourceRoot,root)));
    expect(files.length).toBeGreaterThanOrEqual(22);
    const violations=files.flatMap(file=>scanR1File(file,fs.readFileSync(file,"utf8")));
    expect(violations).toEqual([]);
  });
  it("quarantines the MCP SDK to the transport layer across the whole src tree",()=>{
    // R-P16: the guard above only scanned the R1 target trees, so a direct SDK
    // import anywhere else (core/, services/, tools/ ...) was invisible.
    const all=walk(sourceRoot);
    expect(all.length).toBeGreaterThan(0);
    const sdkLeaks=all.filter(file=>{
      const rel=path.relative(sourceRoot,file).replace(/\\/g,"/");
      if(sdkAllowedHere(rel))return false;
      const code=fs.readFileSync(file,"utf8");
      return /\b(?:import|export)\s+(?:(?:type\s+)?[\s\S]*?\s+from\s+)?["']@modelcontextprotocol\//.test(code)
        || /\b(?:require|import)\s*\(\s*["']@modelcontextprotocol\//.test(code);
    });
    expect(sdkLeaks.map(f=>path.relative(sourceRoot,f).replace(/\\/g,"/"))).toEqual([]);
  });
});
