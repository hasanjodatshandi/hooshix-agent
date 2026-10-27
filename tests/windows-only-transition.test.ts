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
  it("does not hide failed native Go commands behind a green Windows CI job",()=>{
    const workflow=fs.readFileSync(path.resolve(".github/workflows/ci.yml"),"utf8");
    const start=workflow.indexOf("- name: Go unit tests and Windows status-publisher stress");
    const end=workflow.indexOf("- name: Validate owner-session Windows Git smoke script syntax",start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const lines=workflow.slice(start,end).split(/\r?\n/);
    for(const [command,message] of [
      ["go test ./... -count=1","Go package tests failed"],
      ["go test ./internal/host -run TestStatusWriteSurvivesConcurrentPublishers -count=100","Go stress tests failed"],
      ["go vet ./...","Go vet failed"],
      ["go build ./...","Go build failed"],
    ]){
      const i=lines.findIndex(line=>line.trim()===command);
      expect(i,command).toBeGreaterThan(-1);
      expect(lines[i+1]?.trim()).toBe(`if ($LASTEXITCODE -ne 0) { throw "${message}" }`);
    }
  });
});
