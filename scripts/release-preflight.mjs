#!/usr/bin/env node
// Read-only release preflight. Intentionally never tags, commits, deploys,
// restarts services, or declares public production approval.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8"));
function git(...args) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trimEnd();
}
function digest(name) {
  const target = path.join(repo, name);
  return fs.existsSync(target)
    ? crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex")
    : null;
}
const blockers = [];
const warnings = [];
let branch = null, head = null, dirtyPaths = [], ahead = null;
try {
  branch = git("branch", "--show-current");
  head = git("rev-parse", "HEAD");
  const status = git("status", "--porcelain=v1", "--untracked-files=normal");
  dirtyPaths = status ? status.split(/\r?\n/).map((line) => line.slice(3)) : [];
  if (dirtyPaths.length) blockers.push("DIRTY_WORKTREE: create and review an isolated, committed release source tree before tagging");
  try {
    ahead = Number(git("rev-list", "--count", "@{u}..HEAD"));
    if (ahead > 0) warnings.push("LOCAL_COMMITS_NOT_ON_UPSTREAM: verify intended commits and remote synchronization");
  } catch { warnings.push("UPSTREAM_NOT_CONFIGURED: verify source provenance manually"); }
} catch (error) {
  blockers.push("GIT_METADATA_UNAVAILABLE: " + String(error?.message ?? error).split("\n")[0]);
}
const major = Number(process.versions.node.split(".")[0]);
if (!Number.isInteger(major) || major < 24) blockers.push("NODE_BELOW_MINIMUM_24");
let pnpmVersion = null;
try {
  // On Windows pnpm is often a .cmd shim; execFileSync cannot launch it directly.
  pnpmVersion = process.platform === "win32"
    ? execFileSync("cmd.exe", ["/d", "/s", "/c", "pnpm --version"], { cwd: repo, encoding: "utf8" }).trim()
    : execFileSync("pnpm", ["--version"], { cwd: repo, encoding: "utf8" }).trim();
} catch { blockers.push("PNPM_NOT_AVAILABLE"); }
const pinnedPnpm = pkg.packageManager?.match(/^pnpm@(.+)$/)?.[1] ?? null;
if (!pinnedPnpm) blockers.push("PNPM_VERSION_NOT_PINNED");
else if (pnpmVersion && pnpmVersion !== pinnedPnpm) blockers.push("PNPM_VERSION_MISMATCH: expected " + pinnedPnpm);
const distEntries = ["dist/index-http.js", "dist/index.js"];
for (const entry of distEntries) if (!fs.existsSync(path.join(repo, entry))) blockers.push("BUILD_MISSING: " + entry);
const trackedDigests = Object.fromEntries(
  ["package.json", "pnpm-lock.yaml", "src/core/memory/database/migrations.ts", ...distEntries]
    .map((name) => [name, digest(name)])
);
const result = {
  kind: "local_release_preflight",
  verdict: blockers.length ? "NO_GO" : "LOCAL_SOURCE_GATES_PASS",
  publicProductionApproval: "NOT_EVALUATED",
  source: { branch, head, aheadOfUpstream: ahead, dirtyFileCount: dirtyPaths.length, dirtyPaths },
  runtime: { node: process.versions.node, pnpm: pnpmVersion, pinnedPnpm },
  expectedToolInventory: 53, // validated by the complete MCP registry test, not by this read-only preflight
  sdk: pkg.dependencies?.["@modelcontextprotocol/sdk"] ?? null,
  digestsSha256: trackedDigests,
  blockers,
  warnings,
  outstandingManualGates: [
    "Official docs/implementation/27_RELEASE_READINESS_CHECKLIST.md and 29_IMPLEMENTATION_PROGRESS_LEDGER.md",
    "Representative database-copy migration, integrity and restore-drill evidence",
    "Authentication, external HTTP exposure, watchdog ownership and operator-approved cutover/rollback",
    "Release tag/commit provenance and owner approval"
  ]
};
console.log(JSON.stringify(result, null, 2));
if (blockers.length) process.exitCode = 1;
