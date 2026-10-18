import { spawn } from "../spawn.js";
import fs from "node:fs/promises";
import path from "node:path";
import { validateWorkspace } from "../../security/workspace-guard.js";
import { policyDecisionPoint } from "../../core/governance/policy-decision-point.js";
import { logCommandAction } from "../../memory/command-audit.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";
import { assertCwdExists, describeExecaFailure } from "../execa-result.js";
import { runOwnerWorker } from "./owner-worker-client.js";

export interface GitResult { exitCode: number; stdout: string; stderr: string; correlationId: string }

function validateRef(ref: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(ref) || ref.includes("..") || ref.includes("@{") || ref.endsWith(".") || ref.endsWith("/") || ref.includes("//")) {
    throw new Error("Invalid Git ref");
  }
  return ref;
}

interface OwnerFallbackOptions {
  /** Set only when native Git proves cross-owner rejection and delegation succeeds. */
  onDelegated?: () => void;
  /** Reuse the same trusted owner worker after successful preflight. */
  requireOwnerWorker?: boolean;
}

async function runGit(tool: string, args: string[], cwd: string, correlationId?: string,
  timeout = 120000, ownerFallback: OwnerFallbackOptions = {}): Promise<GitResult> {
  policyDecisionPoint.assertAllowed({ tool, arguments: { args, cwd }, correlationId });
  const traceId = resolveCorrelationId(correlationId);
  const safeCwd = validateWorkspace(cwd);
  // Fail fast on a non-existent cwd instead of a confusing spawn failure.
  assertCwdExists(safeCwd, "Git working directory");
  const result = ownerFallback.requireOwnerWorker ? null :
    await spawn("git", args, { cwd: safeCwd, shell: false, reject: false, timeout, maxBuffer: 2 * 1024 * 1024 });
  let outcome: { exitCode: number; stdout: string; stderr: string; timedOut?: boolean };
  if (ownerFallback.requireOwnerWorker) {
    // The preceding rev-parse was rejected by native Git for ownership,
    // then passed the worker's independent SID and command checks.
    // Do not retry native Git: 'git diff' reports exit 129 "not a repository"
    // for an untrusted checkout instead of the original ownership error.
    const delegated = await runOwnerWorker(tool, args, safeCwd);
    if (!delegated) throw new Error("owner_git_worker_unavailable_after_preflight");
    outcome = delegated;
  } else {
    if (!result) throw new Error("native_git_result_missing");
    outcome = { ...result, exitCode: result.exitCode ?? -1 };
    if (!result.timedOut && result.exitCode !== 0 &&
        /dubious ownership/i.test(result.stderr) &&
        !["git_init", "git_clone"].includes(tool)) {
      const delegated = await runOwnerWorker(tool, args, safeCwd);
      if (delegated) {
        outcome = delegated;
        ownerFallback.onDelegated?.();
      }
    }
  }
  await logCommandAction({ command: "git", args, cwd: safeCwd, exitCode: outcome.exitCode,
    status: outcome.timedOut ? "timeout" : outcome.exitCode === 0 ? "success" : "failed", correlationId: traceId });
  if (outcome.timedOut) throw new Error("Git command timed out");
  if (outcome.exitCode !== 0) throw new Error(outcome.stderr || (result ? describeExecaFailure("git", result) : "owner_git_worker_operation_failed"));
  return { exitCode: outcome.exitCode, stdout: outcome.stdout, stderr: outcome.stderr, correlationId: traceId };
}

export function gitStatus(cwd: string, correlationId?: string) {
  return runGit("git_status", ["status", "--porcelain=v1", "--branch"], cwd, correlationId);
}

export function gitDiff(cwd: string, staged = false, correlationId?: string) {
  let ownerVerified = false;
  return runGit("git_diff", ["rev-parse", "--is-inside-work-tree"], cwd, correlationId,
    120000, { onDelegated: () => { ownerVerified = true; } }).then(() =>
    runGit("git_diff", ["diff", ...(staged ? ["--cached"] : []), "--"], cwd, correlationId,
      120000, { requireOwnerWorker: ownerVerified }));
}

export async function gitClone(url: string, targetPath: string, correlationId?: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("Only credential-free HTTPS Git URLs are allowed");
  const target = validateWorkspace(targetPath);
  const parent = validateWorkspace(path.dirname(target));
  const exists = await fs.access(target).then(() => true, () => false);
  if (exists) throw new Error("Clone target already exists");
  await fs.mkdir(parent, { recursive: true });
  return runGit("git_clone", ["clone", "--", parsed.toString(), target], parent, correlationId, 300000);
}

export function gitCommit(cwd: string, message: string, correlationId?: string) {
  if (!message.trim() || message.length > 500) throw new Error("Commit message must contain 1-500 characters");
  return runGit("git_commit", ["commit", "-m", message], cwd, correlationId);
}

export function gitBranch(cwd: string, name: string, correlationId?: string) {
  return runGit("git_branch", ["branch", "--", validateRef(name)], cwd, correlationId);
}

export function gitCheckout(cwd: string, name: string, create = false, correlationId?: string) {
  const ref = validateRef(name);
  return runGit("git_checkout", ["switch", ...(create ? ["-c"] : []), ref], cwd, correlationId);
}

export function gitAdd(cwd: string, paths: string[], correlationId?: string) {
  if (!paths.length) throw new Error("At least one path is required");
  return runGit("git_add", ["add", "--", ...paths], cwd, correlationId);
}

export function gitInit(targetPath: string, initialBranch = "main", correlationId?: string) {
  const resolved = validateWorkspace(targetPath);
  // Use the resolved target path as cwd (not dirname) so the workspace
  // validation in runGit accepts the exact active workspace root (TR-06).
  return runGit("git_init", ["init", "-b", validateRef(initialBranch), resolved], resolved, correlationId);
}

export function gitLog(cwd: string, limit = 20, correlationId?: string) {
  // Defense in depth for the flag interpolation: the git_log tool schema already
  // constrains limit to an int in [1,100], but this service is also called
  // directly. Coerce to a safe integer so no caller can smuggle extra argv
  // through the `--max-count=${limit}` template.
  const safeLimit = Math.min(Math.max(Math.trunc(Number(limit) || 20), 1), 100);
  return runGit("git_log", ["log", `--max-count=${safeLimit}`, "--oneline", "--decorate"], cwd, correlationId)
    .catch((error: unknown) => {
      // An initialized, trusted repository with an unborn branch has an empty
      // history, not a broken Git installation. Do not disguise repository
      // trust errors, missing Git executables, or other failures as no commits.
      if (error instanceof Error && /your current branch '.+' does not have any commits yet/.test(error.message)) {
        return { exitCode: 0, stdout: "", stderr: "", correlationId: resolveCorrelationId(correlationId) };
      }
      throw error;
    });
}

export async function gitHasIdentity(cwd: string): Promise<boolean> {
  const safeCwd = validateWorkspace(cwd);
  assertCwdExists(safeCwd, "Git working directory");
  const identityOpts = { cwd: safeCwd, shell: false, reject: false };
  const name = await spawn("git", ["config", "user.name"], identityOpts);
  const email = await spawn("git", ["config", "user.email"], identityOpts);
  return name.exitCode === 0 && email.exitCode === 0 && !!name.stdout.trim() && !!email.stdout.trim();
}