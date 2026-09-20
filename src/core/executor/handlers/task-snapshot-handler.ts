import { execa } from "execa";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ToolHandler, ToolHandlerContext } from "./tool-handler.js";
import type { ToolName } from "../../../application/services/legacy-tool-orchestrator.js";
import { validateWorkspace } from "../../../security/workspace-guard.js";
import { canonicalizePath } from "../../memory/task-repository.js";
import { findTaskGitSnapshot, storeTaskGitSnapshot } from "../../../adapters/outbound/persistence/sqlite/repositories/task-snapshot-storage.adapter.js";

const TASK_SNAPSHOT_TOOLS: ReadonlySet<ToolName> = new Set(["task_snapshot", "task_rollback"]);

/** Strict git commit id — blocks shell metacharacters even though argv-separated. */
const GIT_SHA = /^[0-9a-f]{40}$/i;

interface GitSnapshot {
  head: string;
  branch: string;
  clean: boolean;
  status: string;
  cwd: string;
  errorType?: "GIT_NO_INITIAL_COMMIT";
}

interface TaskSnapshotCaptureResult {
  snapshotId: string;
  head: string;
  branch: string;
  clean: boolean;
  cwd: string;
  error?: "GIT_NO_INITIAL_COMMIT" | "NOT_A_GIT_REPOSITORY";
  errorType?: "GIT_NO_INITIAL_COMMIT";
  message?: string;
}

async function runGitSnapshot(cwd: string): Promise<GitSnapshot> {
  const opts = { cwd, reject: false, encoding: "utf8" as const, timeout: 10000 };
  let head = ""; let branch = ""; let clean = true; let status = "";
  // Check if .git exists to distinguish "no repo" from "repo with no commits"
  const hasGitDir = fs.existsSync(cwd) && fs.existsSync(path.join(cwd, ".git"));
  const headResult = await execa("git", ["rev-parse", "HEAD"], opts);
  head = headResult.stdout.trim();
  // Detect empty repo: .git exists but HEAD is empty or non-SHA → no initial commit
  if (hasGitDir && (!head || !GIT_SHA.test(head))) {
    return { head: "", branch: "", clean: true, status: "", cwd, errorType: "GIT_NO_INITIAL_COMMIT" };
  }
  try { branch = (await execa("git", ["rev-parse", "--abbrev-ref", "HEAD"], opts)).stdout.trim(); } catch { /* detached */ }
  try { status = (await execa("git", ["status", "--porcelain"], opts)).stdout.trim(); clean = status.length === 0; } catch { /* no git */ }
  if (head && !GIT_SHA.test(head)) throw new Error("git rev-parse HEAD returned an invalid commit id");
  return { head, branch, clean, status, cwd };
}

/** Shared task snapshot/rollback logic — used by both the executor handler and the MCP tools. */
export async function captureTaskSnapshot(cwd: string, correlationId: string): Promise<TaskSnapshotCaptureResult> {
  const safeCwd = validateWorkspace(cwd);
  const snap = await runGitSnapshot(safeCwd);
  // Detect GIT_NO_INITIAL_COMMIT: .git exists but no commits yet (BUG-03)
  if (snap.errorType === "GIT_NO_INITIAL_COMMIT") {
    return { snapshotId: "", head: "", branch: "", clean: false, cwd: safeCwd, error: "GIT_NO_INITIAL_COMMIT", errorType: "GIT_NO_INITIAL_COMMIT", message: "Cannot create snapshot because repository has no commits" };
  }
  // Reject non-Git directories at snapshot creation (TR-11/TR-12)
  if (!snap.head) {
    return { snapshotId: "", head: "", branch: "", clean: false, cwd: safeCwd, error: "NOT_A_GIT_REPOSITORY" };
  }
  const snapshotId = randomUUID();
  storeTaskGitSnapshot(snapshotId, correlationId, safeCwd, Buffer.from(JSON.stringify(snap)));
  return { snapshotId, head: snap.head, branch: snap.branch, clean: snap.clean, cwd: safeCwd };
}

export async function rollbackTaskSnapshot(snapshotId: string, cwd: string): Promise<{ snapshotId: string; rolledBackTo: string; clean: boolean; cwd: string }> {
  const safeCwd = validateWorkspace(cwd);
  const opts = { cwd: safeCwd, reject: false, encoding: "utf8" as const, timeout: 30000 };
  const row = findTaskGitSnapshot(snapshotId);
  if (!row) throw new Error("Snapshot not found");
  if (!row.path.startsWith("__task_snapshot__:")) throw new Error("Not a task snapshot id — use restore_file for file backups");
  const snap = JSON.parse(row.content.toString()) as GitSnapshot;
  if (!snap.head) throw new Error("Snapshot has no git HEAD — cannot rollback a non-git workspace");
  if (!GIT_SHA.test(snap.head)) throw new Error("Snapshot HEAD is not a valid commit id");
  if (snap.cwd && canonicalizePath(snap.cwd) !== canonicalizePath(safeCwd)) {
    throw new Error(`cwd does not match the snapshot directory (${snap.cwd})`);
  }
  const reset = await execa("git", ["reset", "--hard", snap.head, "--"], opts);
  if (reset.exitCode !== 0) throw new Error(reset.stderr || "git reset --hard failed");
  const cleanRun = await execa("git", ["clean", "-fd"], opts);
  if (cleanRun.exitCode !== 0) throw new Error(cleanRun.stderr || "git clean -fd failed");
  const newHead = (await execa("git", ["rev-parse", "HEAD"], opts)).stdout.trim();
  const newStatus = (await execa("git", ["status", "--porcelain"], opts)).stdout.trim();
  return { snapshotId, rolledBackTo: newHead, clean: newStatus.length === 0, cwd: safeCwd };
}

/**
 * Executor handler for task_snapshot / task_rollback — mirrors the MCP tool
 * implementations in tools/task/index.ts with the same security constraints:
 * argv-separated git invocations, strict HEAD validation, workspace-validated
 * cwd, and snapshot-id checks (magic path prefix + cwd match).
 */
export class TaskSnapshotToolHandler implements ToolHandler {
  canHandle(tool: ToolName): boolean {
    return TASK_SNAPSHOT_TOOLS.has(tool);
  }

  async handle({ tool, input, correlationId }: ToolHandlerContext): Promise<unknown> {
    if (tool === "task_snapshot") {
      const cwd = typeof input.cwd === "string" ? input.cwd : "";
      return captureTaskSnapshot(cwd, correlationId);
    }
    const snapshotId = typeof input.snapshotId === "string" ? input.snapshotId : "";
    const cwd = typeof input.cwd === "string" ? input.cwd : "";
    return rollbackTaskSnapshot(snapshotId, cwd);
  }
}