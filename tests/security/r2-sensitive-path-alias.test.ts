import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDisposableFixture, type DisposableFixture } from "../helpers/r0-disposable-fixtures.js";
import { addWorkspaceRoots, getWorkspaceRoot, removeWorkspaceRoot, setActiveWorkspace } from "../../src/security/workspace-guard.js";
import { readWorkspaceFile, searchWorkspaceFiles } from "../../src/services/filesystem/filesystem-service.js";
import { isSensitivePath } from "../../src/application/services/sensitive-path-policy.js";

let fixture:DisposableFixture|undefined;
let previous:string|null=null;
afterEach(()=>{
  if (previous) setActiveWorkspace(previous);
  if (fixture) {
    try { removeWorkspaceRoot(fixture.root); } catch { /* restored outside this fixture */ }
    fixture.cleanup();
  }
  fixture=undefined;
  previous=null;
});
describe("R2.06 shared sensitive read/search/traversal boundary",()=>{
  it("recognizes sensitive basenames, directories and path separator variants",()=>{
    for(const candidate of ["C:\\safe\\.env.test","/fixture/.token","/fixture/.SSH/id_rsa","/fixture/.aws/credentials","/fixture/secret.PEM","/fixture/.ENV.docker"]){
      expect(isSensitivePath(candidate),candidate).toBe(true);
    }
    expect(isSensitivePath("/fixture/src/main.ts")).toBe(false);
  });
  it("denies a sensitive target hidden behind an in-workspace junction/symlink alias",async()=>{
    fixture=createDisposableFixture("r2-sensitive");
    previous=getWorkspaceRoot();
    const root=fixture.root;
    const protectedDir=path.join(root,".ssh");
    fs.mkdirSync(protectedDir);
    const sentinel="R2_DISPOSABLE_SECRET_MARKER";
    fs.writeFileSync(path.join(protectedDir,"id_rsa"),sentinel);
    const alias=path.join(root,"public_alias");
    fs.symlinkSync(protectedDir,alias,process.platform==="win32"?"junction":"dir");
    addWorkspaceRoots([root]);
    setActiveWorkspace(root);
    const readSpy=vi.spyOn(fsPromises,"readFile");
    try {
      await expect(readWorkspaceFile(path.join(alias,"id_rsa"))).rejects.toThrow(/sensitive-file denylist/i);
      await expect(searchWorkspaceFiles(alias,sentinel)).rejects.toThrow(/sensitive-file denylist/i);
      const scan=await searchWorkspaceFiles(root,sentinel);
      expect(scan.matches).toEqual([]);
      // The secret is skipped before any content read, even through an alias.
      expect(readSpy.mock.calls.some(([candidate])=>{
        const name=String(candidate).replace(/\\/g,"/").toLowerCase();
        return name.includes("/.ssh/") || name.includes("/public_alias/");
      })).toBe(false);
    } finally { readSpy.mockRestore(); }
  });
});