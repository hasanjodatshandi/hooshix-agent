#!/usr/bin/env node
// Windows-only release contract. Run against source before building, and
// against a fresh staged payload when --installer is supplied. Fail closed.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {fileURLToPath} from "node:url";
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
function assert(ok,message){if(!ok)throw new Error("windows_only_audit: "+message)}
const disallowed=[
  "deploy/windows/cmd/hooshix-wsl-fs-broker/main.go",
  "deploy/windows/internal/host/wsl.go",
  "deploy/windows/internal/gitworker/wslfs_windows.go",
  "src/security/wsl-workspace-client.ts",
  "src/services/shell/wsl-worker-client.ts",
  "scripts/enroll-wsl-files.ps1",
];
for(const rel of disallowed)assert(!fs.existsSync(path.join(repo,rel)),"obsolete WSL source remains: "+rel);
// The public repository and embedded installer are the free Apache-2.0 edition.
// Enforce this in package metadata and prevent a stale vulnerable transitive
// Hono version from silently overriding the intended workspace-wide pin.
const pkg=JSON.parse(fs.readFileSync(path.join(repo,"package.json"),"utf8"));
assert(pkg.license==="Apache-2.0","free edition must declare SPDX Apache-2.0 in package.json");
const workspace=fs.readFileSync(path.join(repo,"pnpm-workspace.yaml"),"utf8");
const override=workspace.match(/^  hono: ['"]?(\d+\.\d+\.\d+)/m);
assert(override!==null,"Hono override must be configured in pnpm-workspace.yaml");
const honoVersion=override[1];
const versionParts=honoVersion.split(".").map(Number);
assert(versionParts[0]>4||(versionParts[0]===4&&
  (versionParts[1]>13||(versionParts[1]===13&&versionParts[2]>=11))),
  "Hono override must be at least 4.13.11");
const lock=fs.readFileSync(path.join(repo,"pnpm-lock.yaml"),"utf8");
const resolvedHono=[...new Set([...lock.matchAll(/^  hono@(\d+\.\d+\.\d+):/gm)].map(x=>x[1]))];
assert(resolvedHono.length===1&&resolvedHono[0]===honoVersion,
  "Lockfile must contain only the patched Hono version declared in workspace overrides");
const builder=fs.readFileSync(path.join(repo,"scripts/build-windows-installer.mjs"),"utf8");
assert(!/buildLinuxBinary|hooshix-wsl-fs-broker|enroll-wsl-files\.ps1/.test(builder),
  "Windows installer still packages Linux integration");
const cfg=fs.readFileSync(path.join(repo,"src/tools/shell/exec.ts"),"utf8");
assert(!/z\.enum\(\[[^\]]*["']wsl["']/.test(cfg),"WSL shell still exposed through MCP");
const raw=fs.readFileSync(path.join(repo,"deploy/windows/cmd/hooshix-git-worker/main.go"),"utf8");
assert(!/wslfs-|wslgit-|wsl-worker|wsl-proxy/.test(raw),"owner worker still accepts WSL mode");
const installerIndex=process.argv.indexOf("--installer");
if(installerIndex>=0){
 const installer=process.argv[installerIndex+1];
 assert(installer && fs.existsSync(installer),"missing installer for runtime audit");
 const payload=path.join(repo,"deploy/windows/build/payload");
 assert(fs.existsSync(path.join(payload,"bin/hooshix-git-worker.exe")),"Windows Git worker missing");
 assert(fs.existsSync(path.join(payload,"app/LICENSE")),"license absent from payload");
 assert(fs.existsSync(path.join(payload,"app/QUICKSTART.txt")),"customer first-run guide missing from installer payload");
 const bundledHono=JSON.parse(fs.readFileSync(path.join(payload,"app/node_modules/hono/package.json"),"utf8"));
 assert(bundledHono.version===honoVersion,"installer payload contains a different or vulnerable Hono version");
 assert(!fs.existsSync(path.join(payload,"bin/hooshix-wsl-fs-broker-linux-amd64")),"Linux broker still in payload");
 assert(!fs.existsSync(path.join(payload,"tools/enroll-wsl-files.ps1")),"WSL enrollment still in payload");
 for(const stale of ["security/wsl-file-backup.js","security/wsl-mutation-service.js","security/wsl-workspace-binding.js","security/wsl-workspace-client.js","security/wsl-workspace-uri.js","services/shell/wsl-worker-client.js"]) {
   assert(!fs.existsSync(path.join(payload,"app/dist",stale)),"stale WSL JavaScript bundled: "+stale);
 }
 const checksum=fs.readFileSync(installer+".sha256","utf8").trim().split(/\s+/)[0].toLowerCase();
 const actual=crypto.createHash("sha256").update(fs.readFileSync(installer)).digest("hex");
 assert(checksum===actual,"Installer checksum mismatch");
}
console.log(JSON.stringify({kind:"hooshix_windows_only_audit",verdict:"PASS",installer:installerIndex>=0}));
