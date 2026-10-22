#!/usr/bin/env node
/**
 * Read-only release-source provenance and staged installer integrity gate.
 * NEVER stages, commits, copies worktree content, installs, enrolls WSL,
 * stops services, writes Git config, or changes file permissions.
 *
 * usage: node scripts/audit-wsl-release-candidate.mjs [--installer absolute-path]
 * JSON is printed to stdout; exit 1 is a release NO_GO, not an execution error.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function git(...args) {
  return execFileSync("git", args, {
    cwd: repo, encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
function hashFile(file) {
  const data = fs.readFileSync(file);
  return crypto.createHash("sha256").update(data).digest("hex");
}
function worktreeChanges() {
  // -z is required: quoted/escaped/Unicode file names cannot change the
  // apparent number or identity of Git paths in a security release report.
  const tokens = git("status", "--porcelain=v1", "-z", "--untracked-files=all").split("\0");
  const records = [];
  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i];
    if (!entry) continue;
    const xy = entry.slice(0, 2);
    const filename = entry.slice(3);
    if ((xy.includes("R") || xy.includes("C")) && tokens[i + 1]) i++;
    records.push({ status: xy, path: filename });
  }
  return records;
}
function group(file) {
  const clean = file.replaceAll("\\", "/");
  if (/^(?:%SystemDrive%|%[^/]+%|[A-Za-z]:)\//i.test(clean) ||
      clean.startsWith("../") || clean.startsWith("//")) return "unexpected_pseudo_system_path";
  if (/^(?:deploy\/windows\/internal\/(?:wslfs|gitworker)\/|deploy\/windows\/cmd\/hooshix-(?:git-worker|wsl-fs-broker)\/|src\/security\/wsl-|tests\/wsl-|scripts\/(?:enroll-wsl|preflight-wsl))/i.test(clean))
    return "native_wsl";
  if (/^(?:src\/|deploy\/windows\/|scripts\/|\.github\/|package\.json|pnpm-lock\.yaml|tests\/)/i.test(clean))
    return "cross_cutting_runtime_or_release";
  return "additional_unreviewed_content";
}
function compareInstaller(filename) {
  if (!filename) return { checked: false };
  const resolved = path.resolve(filename);
  // CI places the newly built installer in the runner's dedicated temp dir.
  // Local operator staging stays under build/. Restrict to either known root:
  // arbitrary external paths must not be treated as release artifacts.
  const roots = [path.join(repo, "deploy", "windows", "build")];
  if (process.env.RUNNER_TEMP) roots.push(path.resolve(process.env.RUNNER_TEMP));
  const permitted = roots.some(root => {
    const within = path.relative(root, resolved);
    return within !== "" && within !== ".." && !within.startsWith(".." + path.sep) &&
      !path.isAbsolute(within);
  });
  if (!permitted)
    throw new Error("installer must be inside deploy/windows/build staging directory or RUNNER_TEMP");
  const exists = fs.existsSync(resolved) && fs.statSync(resolved).isFile();
  const sidecar = resolved + ".sha256";
  if (!exists) return { checked: true, present: false, integrity: "MISSING" };
  const digest = hashFile(resolved);
  const expected = fs.existsSync(sidecar)
    ? fs.readFileSync(sidecar, "utf8").trim().split(/\s+/)[0].toLowerCase()
    : null;
  return {
    checked: true, present: true, path: resolved, sizeBytes: fs.statSync(resolved).size,
    sha256: digest, sidecarPresent: Boolean(expected),
    integrity: expected === digest ? "PASS" : "FAIL",
  };
}
function main() {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== "--installer"))
    throw new Error("usage: audit-wsl-release-candidate.mjs [--installer absolute-path]");
  const changes = worktreeChanges();
  const groups = { native_wsl: [], cross_cutting_runtime_or_release: [],
    additional_unreviewed_content: [], unexpected_pseudo_system_path: [] };
  for (const item of changes) groups[group(item.path)].push(item);
  const source = {
    commit: git("rev-parse", "HEAD").trim(),
    branch: git("branch", "--show-current").trim(),
    changedPathCount: changes.length,
    untrackedPathCount: changes.filter(x => x.status === "??").length,
    groups,
    clean: changes.length === 0,
  };
  const pkg = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8"));
  const ci = fs.readFileSync(path.join(repo, ".github", "workflows", "ci.yml"), "utf8");
  const pinAligned = /^pnpm@\d+\.\d+\.\d+$/.test(pkg.packageManager) &&
    !ci.includes("pnpm@11.24.0") && !ci.includes('= "11.24.0"') &&
    ci.includes("packageManager.split") &&
    ci.includes("Get-Content package.json");
  const installer = compareInstaller(args.length ? args[1] : null);
  const blockers = [];
  if (!source.clean) blockers.push("DIRTY_SOURCE_WITH_UNCOMMITTED_CHANGES");
  if (groups.unexpected_pseudo_system_path.length)
    blockers.push("PSEUDO_SYSTEM_PATH_IN_SOURCE_TREE_REQUIRES_INVESTIGATION");
  if (!pinAligned) blockers.push("CI_PACKAGE_MANAGER_PIN_INCONSISTENT");
  if (installer.checked && installer.integrity !== "PASS")
    blockers.push("STAGING_INSTALLER_INTEGRITY_NOT_VERIFIED");
  // Successful local tests and checksum do not replace signed, reviewed,
  // immutable source provenance or independent deployment/rollback approval.
  const report = {
    kind: "hooshix_wsl_release_source_audit",
    verdict: blockers.length ? "NO_GO" : "LOCAL_SOURCE_PROVENANCE_GATE_PASS",
    productionApproval: false,
    source,
    packageManager: pkg.packageManager,
    ciPackageManagerPinAligned: pinAligned,
    installer,
    blockers,
    pendingManualGates: [
      "review all changes; separate unrelated modifications and unexpected pseudo-system files",
      "commit and independently review an immutable release candidate; sign if required",
      "rebuild and verify installer from that exact commit",
      "verify independent administrator-run preupgrade backup and rollback rehearsal",
      "validate non-elevated Windows owner enrollment and WSL open_project in installed MCP",
    ],
  };
  console.log(JSON.stringify(report, null, 2));
  if (blockers.length) process.exitCode = 1;
}
try { main(); } catch (error) {
  console.error(String(error?.message ?? error));
  process.exitCode = 2;
}
