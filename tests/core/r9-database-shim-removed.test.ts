import fs from "node:fs";
import path from "node:path";
import {describe,expect,it} from "vitest";

/**
 * R9 facade removal — the pure re-export shim `src/core/memory/database.ts`
 * is gone and must not come back. It was a 15-line file whose only contents
 * were `export { ... } from "./database/index.js"`, kept alive by 55 importers
 * that could equally well have pointed at the real module. A shim like that is
 * dead weight: it cannot be deleted without touching every importer, and an
 * importer that diverges from the real module creates a second source of truth
 * for the database API.
 *
 * The removal is only honest if it cannot regress. This test asserts the file
 * is absent and that no source, test or script imports the bare shim path.
 */

const REPO=process.cwd();

describe("R9 the database shim is gone and cannot return",()=>{
  it("the pure re-export shim no longer exists",()=>{
    const shim=path.resolve(REPO,"src","core","memory","database.ts");
    expect(fs.existsSync(shim),"src/core/memory/database.ts is still present").toBe(false);
    // The real module it used to re-export must still exist.
    expect(fs.existsSync(path.resolve(REPO,"src","core","memory","database","index.ts"))).toBe(true);
  });

  it("nothing imports the bare shim path anymore",()=>{
    const violations:string[]=[];
    function walk(dir:string):void{
      let entries:fs.Dirent[];
      try{entries=fs.readdirSync(dir,{withFileTypes:true});}
      catch{return;}
      for(const entry of entries){
        if(entry.isDirectory()){walk(path.join(dir,entry.name));continue;}
        if(!/\.tsx?$/.test(entry.name))continue;
        const relative=path.relative(REPO,path.join(dir,entry.name)).replace(/\\/g,"/");
        const source=fs.readFileSync(path.join(dir,entry.name),"utf8");
        // The bare shim path ends in database.js with nothing after it. The
        // negative lookahead keeps the real subpaths (database/index.js,
        // database/migrations.js, database/connection.js, database/cleanup.js)
        // out of the violation list.
        for(const line of source.split(/\r?\n/)){
          if(/core\/memory\/database\.js(?!\/)/.test(line))
            violations.push(`${relative}: ${line.trim()}`);
        }
      }
    }
    for(const root of ["src","tests","scripts"])walk(path.resolve(REPO,root));
    expect(violations,`the bare shim is still imported: ${violations.join("; ")}`).toEqual([]);
  });
});
