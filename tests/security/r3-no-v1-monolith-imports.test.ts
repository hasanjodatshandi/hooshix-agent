import fs from "node:fs";
import path from "node:path";
import {describe,expect,it} from "vitest";

/**
 * Checklist item 3.2 — the monolithic v1 SDK is gone. The project moved to the
 * v2 split packages (@modelcontextprotocol/server, /node, /client), and the v1
 * @modelcontextprotocol/sdk dependency was the last surviving import of the old
 * monolith, in this one test helper. Removing the dependency is only honest if
 * nothing can bring it back silently, so this test asserts the absence in the
 * dependency manifest and in every source file.
 */

const REPO=process.cwd();

describe("3.2 the v1 monolithic SDK has no remaining import",()=>{
  it("package.json no longer declares the v1 monolith",()=>{
    const pkg=JSON.parse(fs.readFileSync(path.resolve(REPO,"package.json"),"utf8"));
    const deps={...pkg.dependencies,...pkg.devDependencies};
    expect(deps["@modelcontextprotocol/sdk"],"v1 monolith is still a dependency").toBeUndefined();
    // The v2 split packages must all still be present.
    expect(deps["@modelcontextprotocol/server"]).toBe("2.0.0");
    expect(deps["@modelcontextprotocol/node"]).toBe("2.0.0");
    expect(deps["@modelcontextprotocol/client"]).toBe("2.0.0");
  });

  it("no source, test or script imports the v1 monolith",()=>{
    const roots=["src","tests","scripts"];
    const violations:string[]=[];
    // Defensive references that NAME the v1 monolith in order to forbid or
    // report it are not imports. Keeping them is how the absence stays enforced.
    const defensive=[
      "tests/core/r1-strict-boundary.test.ts",
      "tests/security/r3-no-v1-monolith-imports.test.ts",
      "scripts/release-preflight.mjs",
    ];
    function walk(dir:string):void{
      let entries:fs.Dirent[];
      try{entries=fs.readdirSync(dir,{withFileTypes:true});}
      catch{return;}
      for(const entry of entries){
        if(entry.isDirectory()){walk(path.join(dir,entry.name));continue;}
        if(!/\.[cm]?[tj]sx?$/.test(entry.name))continue;
        const relative=path.relative(REPO,path.join(dir,entry.name)).replace(/\\/g,"/");
        const source=fs.readFileSync(path.join(dir,entry.name),"utf8");
        if(defensive.includes(relative))continue;
        // The exact package specifier, not just a substring: /server or /client
        // imports from the v2 split packages must NOT match.
        for(const line of source.split(/\r?\n/)){
          if(/@modelcontextprotocol\/sdk(?![/])/.test(line)&&!/^\s*(\*|\/\/)/.test(line))
            violations.push(`${relative}: ${line.trim()}`);
        }
      }
    }
    for(const root of roots)walk(path.resolve(REPO,root));
    expect(violations,`v1 monolith still imported: ${violations.join("; ")}`).toEqual([]);
  });
});
