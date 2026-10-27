import {describe, expect, it} from "vitest";
import fs from "node:fs";
import path from "node:path";
import {canonicalizeWorkspacePath} from "../src/security/workspace-policy-repository.js";

describe("Windows-only HooshiX transition",()=>{
  it("refuses old Linux workspace identities without silently granting a Windows path",()=>{
    for(const target of [
      "wsl://Ubuntu/home/coder/workspace/Hooshix",
      "WSL://Ubuntu/home/coder/workspace/Hooshix",
      String.raw`\\wsl.localhost\Ubuntu\home\coder`,
      String.raw`\\wsl$\Ubuntu\home\coder`,
    ]) expect(()=>canonicalizeWorkspacePath(target)).toThrow(/WSL workspace roots are no longer supported/);
  });
  it("ships Windows source only while preserving Windows owner Git support",()=>{
    const root=path.resolve(".");
    for(const retired of [
      "src/security/wsl-workspace-client.ts",
      "src/security/wsl-mutation-service.ts",
      "deploy/windows/internal/host/wsl.go",
      "scripts/enroll-wsl-files.ps1",
    ]) expect(fs.existsSync(path.join(root,retired))).toBe(false);
    expect(fs.existsSync(path.join(root,"deploy/windows/cmd/hooshix-git-worker/main.go"))).toBe(true);
  });
});
