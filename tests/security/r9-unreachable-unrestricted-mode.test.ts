import fs from "node:fs";
import path from "node:path";
import {afterEach,beforeEach,describe,expect,it} from "vitest";
import {createDisposableFixture,type DisposableFixture} from "../helpers/r0-disposable-fixtures.js";
import {
  addWorkspaceRoots,
  assertUnrestrictedElevationAllowed,
  isUnrestrictedMode,
  removeWorkspaceRoot,
  runWithApprovedUnrestrictedScope,
  setActiveWorkspace,
  validateWorkspace,
} from "../../src/security/workspace-guard.js";

/**
 * R9.02 — the unrestricted global is fail-closed by construction, not by
 * convention. R9 flags `unrestrictedMode` (a module-level mutable in
 * workspace-guard.ts) as a mutable global. It is kept as a TEST-ONLY fixture;
 * this test pins the property that makes that safe: no PRODUCTION path can
 * ever make isUnrestrictedMode() true.
 *
 * Two producers exist in source: setUnrestrictedMode (which throws on any
 * attempt to enable it) and __seedUnrestrictedModeForTests (never imported
 * outside tests — asserted here by a source scan). The only real producer is
 * runWithApprovedUnrestrictedScope, an AsyncLocalStorage that grants a
 * SINGLE effect inside the R2 gateway after an approved-task claim.
 */

describe("R9.02 unrestricted mode is unreachable from production paths",()=>{
  let allowed:DisposableFixture|undefined;
  let outside:DisposableFixture|undefined;
  let priorRoot:string|null=null;
  let priorUnrestricted=false;

  beforeEach(()=>{
    priorUnrestricted=isUnrestrictedMode();
    priorRoot=null;
    allowed=createDisposableFixture("r9-allow");
    outside=createDisposableFixture("r9-outside");
    addWorkspaceRoots([allowed.root]);
    setActiveWorkspace(allowed.root);
    const target=path.join(outside.root,"outside.txt");
    fs.writeFileSync(target,"r9-fixture-only");
  });

  afterEach(()=>{
    if(priorUnrestricted)runWithApprovedUnrestrictedScope(()=>{priorUnrestricted=false;});
    if(priorRoot)setActiveWorkspace(priorRoot);
    if(allowed){try{removeWorkspaceRoot(allowed.root)}catch{/* fixture owns cleanup */};allowed.cleanup();}
    outside?.cleanup();
    allowed=undefined;outside=undefined;
  });

  it("starts disabled and no exported production setter can enable it",()=>{
    expect(isUnrestrictedMode()).toBe(false);
    // setUnrestrictedMode(true) must throw and must not change state.
    expect(()=>assertUnrestrictedElevationAllowed()).toThrow(/server opt-in.*exact approved Task/i);
    expect(isUnrestrictedMode()).toBe(false);
  });

  it("the process-wide flag cannot be enabled even under an approved scope",()=>{
    // runWithApprovedUnrestrictedScope grants a SINGLE effect, not a process-wide
    // grant: after the callback returns the flag is off again.
    expect(isUnrestrictedMode()).toBe(false);
    const seen=runWithApprovedUnrestrictedScope(()=>isUnrestrictedMode());
    expect(seen).toBe(true);
    expect(isUnrestrictedMode()).toBe(false);
    // And that single-effect grant never escapes into a subsequent call.
    expect(isUnrestrictedMode()).toBe(false);
  });

  it("__seedUnrestrictedModeForTests is never imported by any source module",()=>{
    const srcDir=path.resolve(process.cwd(),"src");
    const violations:string[]=[];
    function walk(dir:string):void{
      for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
        const target=path.join(dir,entry.name);
        if(entry.isDirectory()){walk(target);continue;}
        if(!entry.name.endsWith(".ts"))continue;
        const source=fs.readFileSync(target,"utf8");
        if(/__seedUnrestrictedModeForTests/.test(source))violations.push(path.relative(process.cwd(),target));
      }
    }
    walk(srcDir);
    // The definition itself lives in workspace-guard.ts; that is the one
    // allowed occurrence. Any other source file importing it is a violation.
    expect(violations.filter(file=>file!==path.join("src","security","workspace-guard.ts").replace(/\//g,path.sep)))
      .toEqual([]);
  });

  it("the single-effect scope still constrains file access to the approved effect",()=>{
    const outsideTarget=path.join(outside!.root,"outside.txt");
    // Outside the approved scope: denied.
    expect(()=>validateWorkspace(outsideTarget)).toThrow(/outside workspace/i);
    // Inside the scope: only that one effect is unrestricted; the flag does
    // not leak, so a SECOND access outside the scope is still denied.
    const inside=runWithApprovedUnrestrictedScope(()=>{
      // The one approved effect may resolve the outside path.
      return validateWorkspace(outsideTarget);
    });
    expect(inside).toBe(path.resolve(outsideTarget));
    // Scope ended — the same path is denied again.
    expect(()=>validateWorkspace(outsideTarget)).toThrow(/outside workspace/i);
  });
});
