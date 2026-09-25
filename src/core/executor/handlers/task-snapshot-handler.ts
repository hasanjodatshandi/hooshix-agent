import { spawn, type SpawnOptions } from "../../../services/spawn.js";
import { randomUUID } from "node:crypto";
import path from "node:path";


import type { ToolHandler, ToolHandlerContext } from "./tool-handler.js";
import type { ToolName } from "../../../application/services/legacy-tool-orchestrator.js";
import { validateWorkspace } from "../../../security/workspace-guard.js";
import { policyDecisionPoint } from "../../governance/policy-decision-point.js";
import { canonicalizePath } from "../../memory/task-repository.js";
import { findTaskGitSnapshot, storeTaskGitSnapshot } from "../../../adapters/outbound/persistence/sqlite/repositories/task-snapshot-storage.adapter.js";

const TASK_SNAPSHOT_TOOLS: ReadonlySet<ToolName> = new Set(["task_snapshot", "task_rollback"]);

/** Strict git commit id — blocks shell metacharacters even though argv-separated. */
const GIT_SHA = /^[0-9a-f]{40}$/i;

interface GitSnapshot {
  schemaVersion?: 1;
  kind?: "clean_git_snapshot";
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
  error?: "GIT_NO_INITIAL_COMMIT" | "NOT_A_GIT_REPOSITORY" | "GIT_DIRTY_SNAPSHOT_UNSUPPORTED";
  errorType?: "GIT_NO_INITIAL_COMMIT";
  message?: string;
}

async function runGitSnapshot(cwd: string): Promise<GitSnapshot> {
  const opts: SpawnOptions = { cwd, reject: false, encoding: "utf8", timeout: 10000 };
  // Repository root, HEAD and the complete tracked/index/untracked status
  // MUST all be observed successfully before creating a rollback capability.
  const root = await spawn("git", ["rev-parse", "--show-toplevel"], opts);
  if (root.exitCode !== 0) {
    return {head:"", branch:"", clean:false, status:"", cwd};
  }
  if (canonicalizePath(root.stdout.trim()) !== canonicalizePath(cwd))
    throw new Error("GIT_REPOSITORY_ROOT_REQUIRED: snapshot cwd must be the repository root");
  const headResult = await spawn("git", ["rev-parse", "--verify", "HEAD"], opts);
  const head = headResult.stdout.trim();
  if (headResult.exitCode !== 0 || !GIT_SHA.test(head)) {
    return {head:"", branch:"", clean:false, status:"", cwd, errorType:"GIT_NO_INITIAL_COMMIT"};
  }
  const branchResult = await spawn("git", ["symbolic-ref", "--short", "-q", "HEAD"], opts);
  if (branchResult.exitCode !== 0 && branchResult.exitCode !== 1)
    throw new Error("GIT_BRANCH_UNVERIFIED: cannot capture Git branch state");
  const branch = branchResult.exitCode === 0 ? branchResult.stdout.trim() : "";
  const statusResult = await spawn("git", ["status", "--porcelain=v1", "--untracked-files=all"], opts);
  if (statusResult.exitCode !== 0)
    throw new Error("GIT_STATUS_UNVERIFIED: cannot prove repository cleanliness");
  const status = statusResult.stdout;
  return {head, branch, clean:status.length===0, status, cwd};
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
  if (!snap.clean) return {snapshotId:"",head:snap.head,branch:snap.branch,clean:false,cwd:safeCwd,
    error:"GIT_DIRTY_SNAPSHOT_UNSUPPORTED",message:"Dirty Git worktrees cannot be captured by the clean-snapshot contract"};
  const snapshotId = randomUUID();
  storeTaskGitSnapshot(snapshotId,correlationId,safeCwd,
    Buffer.from(JSON.stringify({...snap,schemaVersion:1,kind:"clean_git_snapshot"})));
  return {snapshotId,head:snap.head,branch:snap.branch,clean:true,cwd:safeCwd};
}

/** Rollback restores only a previously verified CLEAN Git snapshot. All
 * branch/repository/snapshot checks happen before any destructive subprocess. */
export async function rollbackTaskSnapshot(snapshotId: string, cwd: string): Promise<{snapshotId:string;rolledBackTo:string;clean:boolean;cwd:string}> {
  const safeCwd=validateWorkspace(cwd);
  // The gateway binds its high-risk approval to snapshotId + cwd; this
  // service-level check also rejects calls that bypass the shared gateway.
  policyDecisionPoint.assertAllowed({tool:"task_rollback",arguments:{snapshotId,cwd:safeCwd}});
  const row=findTaskGitSnapshot(snapshotId);
  if(!row) throw new Error("Snapshot not found");
  if(!row.path.startsWith("__task_snapshot__:")) throw new Error("Not a task snapshot id — use restore_file for file backups");
  let snap:GitSnapshot;
  try { snap=JSON.parse(row.content.toString("utf8")) as GitSnapshot; }
  catch { throw new Error("GIT_SNAPSHOT_UNVERIFIED: invalid snapshot payload"); }
  if(snap.schemaVersion!==1||snap.kind!=="clean_git_snapshot"||snap.clean!==true||
    snap.status!==""||typeof snap.cwd!=="string"||!path.isAbsolute(snap.cwd)||
    !GIT_SHA.test(snap.head)||typeof snap.branch!=="string"||
    row.path!=="__task_snapshot__:"+snap.cwd)
    throw new Error("GIT_SNAPSHOT_UNVERIFIED: snapshot does not prove an exact clean repository state");
  if(canonicalizePath(snap.cwd)!==canonicalizePath(safeCwd))
    throw new Error("GIT_SNAPSHOT_REPOSITORY_MISMATCH: cwd does not match the captured repository");
  const opts: SpawnOptions = { cwd: safeCwd, reject: false, encoding: "utf8", timeout: 30000 };
  const root=await spawn("git",["rev-parse","--show-toplevel"],opts);
  if(root.exitCode!==0||canonicalizePath(root.stdout.trim())!==canonicalizePath(safeCwd))
    throw new Error("GIT_SNAPSHOT_REPOSITORY_MISMATCH: target is no longer the captured Git root");
  const branch=await spawn("git",["symbolic-ref","--short","-q","HEAD"],opts);
  if(branch.exitCode!==0&&branch.exitCode!==1)
    throw new Error("GIT_BRANCH_UNVERIFIED: cannot verify current branch");
  const currentBranch=branch.exitCode===0?branch.stdout.trim():"";
  if(currentBranch!==snap.branch)
    throw new Error("GIT_SNAPSHOT_BRANCH_MISMATCH: refusing rollback on another branch");
  const target=await spawn("git",["cat-file","-e",snap.head+"^{commit}"],opts);
  if(target.exitCode!==0)
    throw new Error("GIT_SNAPSHOT_MISSING_COMMIT: captured commit is unavailable");
  const status=await spawn("git",["status","--porcelain=v1","--untracked-files=all"],opts);
  if(status.exitCode!==0)
    throw new Error("GIT_STATUS_UNVERIFIED: cannot inspect repository before rollback");
  // After explicit exact-action approval only: restore tracked HEAD and remove
  // untracked files. Ignored files were never captured and are never promised
  // to be removed. Never use a dirty/legacy snapshot as authority.
  const reset=await spawn("git",["reset","--hard",snap.head],opts);
  if(reset.exitCode!==0) throw new Error(reset.stderr||"git reset --hard failed");
  const cleaned=await spawn("git",["clean","-fd"],opts);
  if(cleaned.exitCode!==0) throw new Error(cleaned.stderr||"git clean -fd failed");
  const newHead=await spawn("git",["rev-parse","--verify","HEAD"],opts);
  const newBranch=await spawn("git",["symbolic-ref","--short","-q","HEAD"],opts);
  const newStatus=await spawn("git",["status","--porcelain=v1","--untracked-files=all"],opts);
  if(newHead.exitCode!==0||newHead.stdout.trim()!==snap.head||
     (newBranch.exitCode===0?newBranch.stdout.trim():"")!==snap.branch||
     newStatus.exitCode!==0||newStatus.stdout.length!==0)
    throw new Error("GIT_ROLLBACK_VERIFICATION_FAILED: exact clean Git snapshot was not restored");
  return {snapshotId,rolledBackTo:snap.head,clean:true,cwd:safeCwd};
}

/** Shared handler: Task and direct MCP dispatch use the same verified operations. */
export class TaskSnapshotToolHandler implements ToolHandler {
  canHandle(tool: ToolName): boolean {
    return TASK_SNAPSHOT_TOOLS.has(tool);
  }

  async handle({tool,input,correlationId}: ToolHandlerContext): Promise<unknown> {
    if(tool==="task_snapshot"){
      const cwd=typeof input.cwd==="string"?input.cwd:"";
      return captureTaskSnapshot(cwd,correlationId);
    }
    const snapshotId=typeof input.snapshotId==="string"?input.snapshotId:"";
    const cwd=typeof input.cwd==="string"?input.cwd:"";
    return rollbackTaskSnapshot(snapshotId,cwd);
  }
}