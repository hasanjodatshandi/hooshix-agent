import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDisposableFixture } from "../helpers/r0-disposable-fixtures.js";
import {
  addWorkspaceRoots, createSessionWorkspaceContext, getWorkspaceRoot, getActiveWorkspace,
  removeWorkspaceRoot, runWithSessionWorkspace, runWithWorkspaceScope, setActiveWorkspace,
  validateWorkspace,
} from "../../src/security/workspace-guard.js";

describe("R2.04 HTTP session workspace isolation and persisted Task override",()=>{
  it("isolates simultaneous HTTP sessions and keeps global stdio state unchanged",async()=>{
    const fixture=createDisposableFixture("r2-sessions");
    const original=getWorkspaceRoot();
    const a=path.join(fixture.root,"a"),b=path.join(fixture.root,"b");
    fs.mkdirSync(a);fs.mkdirSync(b);
    fs.writeFileSync(path.join(a,"a.txt"),"a");
    fs.writeFileSync(path.join(b,"b.txt"),"b");
    try {
      addWorkspaceRoots([a,b]);
      const first=createSessionWorkspaceContext(),second=createSessionWorkspaceContext();
      let wakeSecond!:()=>void;
      const readySecond=new Promise<void>(resolve=>{wakeSecond=resolve});
      await Promise.all([
        runWithSessionWorkspace(first,async()=>{
          setActiveWorkspace(a);
          await readySecond;
          expect(getWorkspaceRoot()).toBe(fs.realpathSync(a));
          expect(validateWorkspace("a.txt")).toBe(path.join(a,"a.txt"));
          expect(()=>validateWorkspace(path.join(b,"b.txt"))).toThrow(/outside workspace/i);
          expect(runWithWorkspaceScope(fs.realpathSync(b),()=>getActiveWorkspace())).toBe(fs.realpathSync(b));
          expect(getWorkspaceRoot()).toBe(fs.realpathSync(a));
        }),
        runWithSessionWorkspace(second,async()=>{
          setActiveWorkspace(b);
          wakeSecond();
          await Promise.resolve();
          expect(getWorkspaceRoot()).toBe(fs.realpathSync(b));
          expect(validateWorkspace("b.txt")).toBe(path.join(b,"b.txt"));
          expect(()=>validateWorkspace(path.join(a,"a.txt"))).toThrow(/outside workspace/i);
        })
      ]);
      expect(getWorkspaceRoot()).toBe(original);
      expect(await runWithSessionWorkspace(first,async()=>getWorkspaceRoot())).toBe(fs.realpathSync(a));
      expect(await runWithSessionWorkspace(second,async()=>getWorkspaceRoot())).toBe(fs.realpathSync(b));
    } finally {
      if(original) setActiveWorkspace(original);
      for(const root of [a,b]) {try{removeWorkspaceRoot(root)}catch{}}
      fixture.cleanup();
    }
  });
});