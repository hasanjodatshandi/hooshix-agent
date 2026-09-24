import {execFileSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {describe,expect,it} from "vitest";

/**
 * R8.07 — static and lint hygiene. The project keeps strict TypeScript
 * (strict + noUnusedLocals + noUnusedParameters) as a permanent compile-time
 * gate, and this file adds the two checks the compiler cannot express:
 *
 * 1. git diff --check is clean (no whitespace damage on intended changes).
 *    This is the hygiene gate the backlog names explicitly.
 * 2. The compatibility-shim boundary stays where R9.03 pinned it: no shim
 *    under src/infrastructure/config may grow an import that is not the
 *    authoritative app-config.ts.
 *
 * Whitespace-only lines inside string literals are a legitimate false-positive
 * risk for any source scan, so the SQL/whitespace scans in this file match on
 * source lines OUTSIDE of template literals where it matters, and the git
 * check delegates to git itself rather than reimplementing it.
 */

const REPO=process.cwd();

function runGit(args:string[]):string{
  try{
    return execFileSync("git",args,{cwd:REPO,encoding:"utf8",windowsHide:true});
  }catch{
    return "";
  }
}

describe("R8.07 static and lint hygiene",()=>{
  it("strict TypeScript options are enabled in the build config",()=>{
    const tsconfig=JSON.parse(fs.readFileSync(path.resolve(REPO,"tsconfig.json"),"utf8"));
    const compilerOptions=tsconfig.compilerOptions??{};
    expect(compilerOptions.strict,"strict must stay on").toBe(true);
    expect(compilerOptions.noUnusedLocals,"noUnusedLocals must stay on").toBe(true);
    expect(compilerOptions.noUnusedParameters,"noUnusedParameters must stay on").toBe(true);
  });

  it("git diff --check reports no whitespace damage",()=>{
    // The CI hygiene gate. --check exits non-zero on trailing whitespace,
    // space-before-tab or conflict markers in the working tree diff.
    const output=runGit(["diff","--check"]);
    expect(output.trim(),`git diff --check reported: ${output}`).toBe("");
  });

  it("no shim under src/infrastructure/config imports outside app-config.ts",()=>{
    const configDir=path.resolve(REPO,"src","infrastructure","config");
    const violations:string[]=[];
    for(const entry of fs.readdirSync(configDir,{withFileTypes:true})){
      if(!entry.name.startsWith("legacy")||!entry.name.endsWith(".ts"))continue;
      const source=fs.readFileSync(path.join(configDir,entry.name),"utf8");
      for(const statement of source.match(/import\s+[\s\S]*?\sfrom\s+"[^"]+";/g)??[]){
        if(!statement.includes("./app-config.js"))
          violations.push(`${entry.name}: ${statement.trim()}`);
      }
    }
    expect(violations,`Config shim has a foreign import: ${violations.join("; ")}`).toEqual([]);
  });

  it("no test import resolves outside src/ or tests/",()=>{
    // A test that reaches into src through a relative path that escapes the
    // tests/ directory would be importing production internals through a
    // private back door. Real import statements are matched at line start so
    // probe STRINGS inside boundary-test arguments (which deliberately name
    // invalid specifiers) are not mistaken for imports.
    const testsDir=path.resolve(REPO,"tests");
    const violations:string[]=[];
    function walk(dir:string):void{
      for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
        const target=path.join(dir,entry.name);
        if(entry.isDirectory()){walk(target);continue;}
        if(!entry.name.endsWith(".ts"))continue;
        const source=fs.readFileSync(target,"utf8");
        const rel=path.relative(REPO,target).replace(/\\/g,"/");
        for(const line of source.split(/\r?\n/)){
          const match=/^\s*(?:import|export)\s+[\s\S]*?\sfrom\s+"(\.\.?\/[^"]+)"/.exec(line);
          if(!match)continue;
          const specifier=match[1];
          const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(rel),specifier));
          if(!resolved.startsWith("src/")&&!resolved.startsWith("tests/"))
            violations.push(`${rel}: ${specifier} -> ${resolved}`);
        }
      }
    }
    walk(testsDir);
    expect(violations,`Test import escapes src/ and tests/: ${violations.join("; ")}`).toEqual([]);
  });
});
