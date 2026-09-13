import { execa } from "execa";
import { randomUUID } from "node:crypto";
import type { ToolHandler, ToolHandlerContext } from "./tool-handler.js";
import type { ToolName } from "../../orchestrator/tool-orchestrator.js";
import { validateWorkspace } from "../../../security/workspace-guard.js";
import { canonicalizePath } from "../../memory/task-repository.js";
import { withAgentDatabase } from "../../memory/database.js";

const TASK_SNAPSHOT_TOOLS: ReadonlySet<ToolName> = new Set(["task_snapshot", "task_rollback"]);

/** Strict git commit id — blocks shell metacharacters even though argv-separated. */
const GIT_SHA = /^[0-9a-f]{40}$/i;

interface GitSnapshot {
  head: string;
  branch: string;
  clean: boolean;
  status: string;
  cwd: string;
}

async function runGitSnapshot(cwd: string): Promise<GitSnapshot> {
  const opts = { cwd, reject: false, encoding: "utf8" as const, timeout: 10000 };
  let head = ""; let branch = ""; let clean = true; let status = "";
  try { head = (await execa("git", ["rev-parse", "HEAD"], opts)).stdout.trim(); } catch { /* no git repo */ }
  try { branch = (await execa("git", ["rev-parse", "--abbrev-ref", "HEAD"], opts)).stdout.trim(); } catch { /* detached */ }
  try { status = (await execa("git", ["status", "--porcelain"], opts)).stdout.trim(); clean = status.length === 0; } catch { /* no git */ }
  if (head && !GIT_SHA.test(head)) throw new Error("git rev-parse HEAD returned an invalid commit id");
  return { head, branch, clean, status, cwd };
}

/** Shared task snapshot/rollback logic — used by both the executor handler and the MCP tools. */
export async function captureTaskSnapshot(cwd: string, correlationId: string): Promise<{ snapshotId: string; head: string; branch: string; clean: boolean; cwd: string }> {
  const safeCwd = validateWorkspace(cwd);
  const snap = await runGitSnapshot(safeCwd);
  const snapshotId = randomUUID();
  withAgentDatabase((db) => db.prepare(
    "INSERT INTO file_backups(id, correlation_id, path, content, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(snapshotId, correlationId, `__task_snapshot__:${safeCwd}`, Buffer.from(JSON.stringify(snap)), new Date().toISOString()));
  return { snapshotId, head: snap.head, branch: snap.branch, clean: snap.clean, cwd: safeCwd };
}

export async function rollbackTaskSnapshot(snapshotId: string, cwd: string): Promise<{ snapshotId: string; rolledBackTo: string; clean: boolean; cwd: string }> {
  const safeCwd = validateWorkspace(cwd);
  const opts = { cwd: safeCwd, reject: false, encoding: "utf8" as const, timeout: 30000 };
  const row = withAgentDatabase((db) => db.prepare(
    "SELECT path, content FROM file_backups WHERE id = ?"
  ).get(snapshotId) as { path: string; content: Buffer } | undefined);
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
