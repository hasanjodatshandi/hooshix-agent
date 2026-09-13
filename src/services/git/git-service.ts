import { execa } from "execa";
import fs from "node:fs/promises";
import path from "node:path";
import { validateWorkspace } from "../../security/workspace-guard.js";
import { policyDecisionPoint } from "../../core/governance/policy-decision-point.js";
import { logCommandAction } from "../../memory/command-audit.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";
import { assertCwdExists, describeExecaFailure } from "../execa-result.js";

export interface GitResult { exitCode: number; stdout: string; stderr: string; correlationId: string }

function validateRef(ref: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(ref) || ref.includes("..") || ref.includes("@{") || ref.endsWith(".") || ref.endsWith("/") || ref.includes("//")) {
    throw new Error("Invalid Git ref");
  }
  return ref;
}

async function runGit(tool: string, args: string[], cwd: string, correlationId?: string, timeout = 120000): Promise<GitResult> {
  policyDecisionPoint.assertAllowed({ tool, arguments: { args, cwd }, correlationId });
  const traceId = resolveCorrelationId(correlationId);
  const safeCwd = validateWorkspace(cwd);
  // Fail fast on a non-existent cwd instead of a confusing spawn failure.
  assertCwdExists(safeCwd, "Git working directory");
  const result = await execa("git", args, { cwd: safeCwd, shell: false, reject: false, timeout, maxBuffer: 2 * 1024 * 1024 });
  await logCommandAction({ command: "git", args, cwd: safeCwd, exitCode: result.exitCode, status: result.timedOut ? "timeout" : result.exitCode === 0 ? "success" : "failed", correlationId: traceId });
  if (result.timedOut) throw new Error("Git command timed out");
  if (result.exitCode !== 0) throw new Error(result.stderr || describeExecaFailure("git", result));
  return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, correlationId: traceId };
}

export function gitStatus(cwd: string, correlationId?: string) {
  return runGit("git_status", ["status", "--porcelain=v1", "--branch"], cwd, correlationId);
}

export function gitDiff(cwd: string, staged = false, correlationId?: string) {
  return runGit("git_diff", ["diff", ...(staged ? ["--cached"] : []), "--"], cwd, correlationId);
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
  return runGit("git_init", ["init", "-b", validateRef(initialBranch), resolved], path.dirname(resolved), correlationId);
}

export function gitLog(cwd: string, limit = 20, correlationId?: string) {
  return runGit("git_log", ["log", `--max-count=${limit}`, "--oneline", "--decorate"], cwd, correlationId);
}

export async function gitHasIdentity(cwd: string): Promise<boolean> {
  const safeCwd = validateWorkspace(cwd);
  assertCwdExists(safeCwd, "Git working directory");
  const name = await execa("git", ["config", "user.name"], { cwd: safeCwd, shell: false, reject: false });
  const email = await execa("git", ["config", "user.email"], { cwd: safeCwd, shell: false, reject: false });
  return name.exitCode === 0 && email.exitCode === 0 && !!name.stdout.trim() && !!email.stdout.trim();
}
