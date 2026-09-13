import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createTaskRuntimeService } from "../../core/runtime/composition-root.js";
import { auditToolCall } from "../../core/memory/tool-audit.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";
import { assertToolPermission } from "../../security/permission.js";
import { listMemoryItems, listProjects, saveMemoryItem, saveProject, getMemoryItem, deleteMemoryItem, getProject, deleteProject, archiveProject, findTaskByIdempotencyKey } from "../../core/memory/task-repository.js";
import { getApprovalRequest } from "../../core/governance/approval-memory.js";
import { policyDecisionPoint } from "../../core/governance/policy-decision-point.js";
import { captureTaskSnapshot, rollbackTaskSnapshot } from "../../core/executor/handlers/task-snapshot-handler.js";
import { TOOL_NAMES } from "../../core/orchestrator/tool-orchestrator.js";
import { ReplayExecutor } from "../../core/trace/replay-executor.js";

const runtime = createTaskRuntimeService();
const traceSchema = { correlationId: z.string().min(1).optional() };
// set_workspace is excluded from task tools — workspace is captured in task.executionContext
const toolName = z.enum(TOOL_NAMES);
const stepSchema = z.object({
  id: z.number().int().positive().optional(),
  action: z.string().min(1).max(500),
  tool: toolName,
  arguments: z.record(z.string(), z.unknown()).default({}),
  dependsOn: z.array(z.number().int().positive()).default([]),
  runWhen: z.enum(["success", "failure", "always"]).default("success"),
  /** Step-level timeout in ms (kills the child process via AbortController).
   *  0 disables. Default when omitted: 30000. Max: 600000. */
  timeout: z.number().int().min(0).max(600000).optional()
});

function response(value: unknown, correlationId: string) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], _meta: { correlationId } };
}

async function progress(extra: { _meta?: { progressToken?: string | number }; sendNotification(input: unknown): Promise<void> }, value: number, total: number, message: string) {
  const progressToken = extra._meta?.progressToken;
  if (progressToken === undefined) return;
  await extra.sendNotification({ method: "notifications/progress", params: { progressToken, progress: value, total, message } });
}

export function registerTaskTools(server: McpServer) {
  server.registerTool("task_create", { title: "Create Task", description: "🗂️ TASK — Persist an explicit multi-step plan. Lifecycle: task_create → task_run → (approval?) task_approve → task_resume → task_report.\n\nEach step: { action, tool, arguments, dependsOn?, runWhen?, timeout? }.\n\nTEMPLATE VARIABLES pass output between steps: {{stepN.output.field}} · {{stepN.output}} · {{stepN.status}} · {{stepN.error}}\n\nExample:\n{ \"title\": \"Setup\", \"steps\": [\n  { \"action\": \"Create pkg\", \"tool\": \"create_file\", \"arguments\": { \"path\": \"package.json\", \"content\": \"{}\" } },\n  { \"action\": \"Install deps\", \"tool\": \"install_package\", \"arguments\": { \"manager\": \"npm\", \"name\": \"express\" }, \"dependsOn\": [1] }\n] }\n\nretryPolicy: { maxTotalAttempts, maxConsecutiveFailures } limits re-runs. idempotencyKey deduplicates retries.", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },    inputSchema: z.object({ title: z.string().min(1).max(200), description: z.string().max(4000).optional(), steps: z.array(stepSchema).min(1).max(100), retryPolicy: z.object({ maxTotalAttempts: z.number().int().min(1).max(100).optional(), maxConsecutiveFailures: z.number().int().min(1).max(50).optional() }).optional(), idempotencyKey: z.string().max(200).optional(), ...traceSchema }) }, async ({ title, description, steps, retryPolicy, idempotencyKey, correlationId }) => {
    assertToolPermission("task_create"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("task_create", traceId, undefined, () => {
      // If idempotencyKey is provided, check for existing task with same key
      if (idempotencyKey) {
        const existingId = findTaskByIdempotencyKey(idempotencyKey);
        if (existingId) return response({ id: existingId, idempotent: true, message: "Existing task returned for this idempotency key" }, traceId);
      }
      return response(runtime.create({ title, description, steps: steps.map((step) => ({ ...step, status: "pending" as const })), retryPolicy, idempotencyKey, correlationId: traceId }), traceId);
    });
  });
  server.registerTool("task_get", { title: "Get Task", description: "🗂️ TASK (read) — Full task object: state, steps with statuses/outputs/errors, pending approval info.\n\nExample: { \"taskId\": \"550e8400-...\" }", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }, inputSchema: z.object({ taskId: z.string().uuid(), ...traceSchema }) }, async ({ taskId, correlationId }) => {
    assertToolPermission("task_get"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("task_get", traceId, taskId, () => response(runtime.get(taskId), traceId));
  });
  server.registerTool("task_list", { title: "List Tasks", description: "🗂️ TASK (read) — Recent task summaries: ids, titles, statuses. limit 1-100 (default 50).\n\nExample: { \"limit\": 10 }", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }, inputSchema: z.object({ limit: z.number().int().min(1).max(100).default(50), ...traceSchema }) }, async ({ limit, correlationId }) => {
    assertToolPermission("task_list"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("task_list", traceId, undefined, () => response(runtime.list(limit), traceId));
  });
  server.registerTool("task_run", { title: "Run Task", description: "🗂️ TASK — Execute a task's next unfinished steps sequentially. Templates ({{stepN.*}}) resolve automatically; transient failures retry with backoff; high-risk steps pause for approval. Idempotent: re-running a finished task is a no-op.\n\nExample: { \"taskId\": \"550e8400-...\" } · maxRecovery 0-3 (default 1).", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }, inputSchema: z.object({ taskId: z.string().uuid(), maxRecovery: z.number().int().min(0).max(3).default(1), ...traceSchema }) }, async ({ taskId, maxRecovery, correlationId }, extra) => {
    assertToolPermission("task_run"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("task_run", traceId, taskId, async () => {
      await progress(extra, 0, 1, "Task started");
      const value = await runtime.run(taskId, maxRecovery);
      await progress(extra, 1, 1, `Task ${value.status}`);
      return response(value, traceId);
    });
  });
  server.registerTool("task_approve", { title: "Approve Task Step", description: "🗂️ TASK — Human approval for a paused high-risk step (delete_file, git mutations, packages…). The task pauses and returns an approvalId; approve it, then task_resume. Single-use.\n\nExample: { \"approvalId\": 42 }", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false }, inputSchema: z.object({ approvalId: z.number().int().positive(), ...traceSchema }) }, async ({ approvalId, correlationId }) => {
    assertToolPermission("task_approve"); const traceId = resolveCorrelationId(correlationId);
    // Resolve taskId from approval request for telemetry association
    const req = getApprovalRequest(approvalId);
    const resolvedTaskId = req?.task_id;
    return auditToolCall("task_approve", traceId, resolvedTaskId, () => response({ approvalId, ...runtime.approve(approvalId) }, traceId));
  });
  server.registerTool("task_resume", { title: "Resume Task", description: "🗂️ TASK — Consume an approval and continue the paused task from its exact step. Use after task_approve. Exactly-once: a consumed approval cannot resume twice.\n\nExample: { \"approvalId\": 42 }", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false }, inputSchema: z.object({ approvalId: z.number().int().positive(), ...traceSchema }) }, async ({ approvalId, correlationId }) => {
    assertToolPermission("task_resume"); const traceId = resolveCorrelationId(correlationId);
    // Resolve taskId from approval request for telemetry association
    const req = getApprovalRequest(approvalId);
    const resolvedTaskId = req?.task_id;
    return auditToolCall("task_resume", traceId, resolvedTaskId, async () => response(await runtime.resume(approvalId), traceId));
  });
  server.registerTool("task_report", { title: "Task Report", description: "🗂️ TASK (read) — Full report: step statuses, unified execution/recovery timeline, reflection (problem/cause/solution), metrics.\n\nExample: { \"taskId\": \"550e8400-...\" }", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }, inputSchema: z.object({ taskId: z.string().uuid(), ...traceSchema }) }, async ({ taskId, correlationId }) => {
    assertToolPermission("task_report"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("task_report", traceId, taskId, () => response(runtime.report(taskId), traceId));
  });
  server.registerTool("task_replay", { title: "Replay Task", description: "🗂️ TASK — Re-execute a copy of a task and compare outputs (reproducibility testing). Blocked if any step mutates unless allowMutations=true.\n\nExample: { \"taskId\": \"550e8400-...\", \"allowMutations\": false }", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }, inputSchema: z.object({ taskId: z.string().uuid(), allowMutations: z.boolean().default(false), ...traceSchema }) }, async ({ taskId, allowMutations, correlationId }) => {
    assertToolPermission("task_replay"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("task_replay", traceId, taskId, async () => response(await new ReplayExecutor(runtime).replay(taskId, allowMutations), traceId));
  });
  server.registerTool("task_cancel", { title: "Cancel Task", description: "🗂️ TASK — Cancel a non-running task and revoke its unconsumed approvals. Fails while a step is actively executing.\n\nExample: { \"taskId\": \"550e8400-...\" }", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true }, inputSchema: z.object({ taskId: z.string().uuid(), ...traceSchema }) }, async ({ taskId, correlationId }) => {
    assertToolPermission("task_cancel"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("task_cancel", traceId, taskId, () => response({ taskId, cancelled: runtime.cancel(taskId) }, traceId));
  });
  server.registerTool("project_save", { title: "Save Project", description: "📁 CONTEXT — Create or update a project record (name, path, description, last/next action). Path is canonicalized; no id = create (fails if path taken), with id = update.\n\nExamples: { \"name\": \"My API\", \"path\": \"D:/Projects/my-api\" } · { \"id\": \"uuid\", \"name\": \"New Name\" }", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }, inputSchema: z.object({ id: z.string().uuid().optional(), name: z.string().min(1).max(200), path: z.string(), description: z.string().max(4000).optional(), lastAction: z.string().max(1000).optional(), nextAction: z.string().max(1000).optional(), ...traceSchema })  }, async ({ correlationId, ...input }) => {
    assertToolPermission("project_save"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("project_save", traceId, undefined, () => response({ id: saveProject(input) }, traceId));
  });
  server.registerTool("project_get", { title: "Get Project", description: "📁 CONTEXT (read) — Fetch one project record by id.\n\nExample: { \"projectId\": \"uuid\" }", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }, inputSchema: z.object({ projectId: z.string().uuid(), ...traceSchema }) }, async ({ projectId, correlationId }) => {
    assertToolPermission("project_list"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("project_get", traceId, undefined, () => response(getProject(projectId), traceId));
  });
  server.registerTool("project_delete", { title: "Delete Project", description: "📁 CONTEXT — Permanently delete a project record by id.\n\nExample: { \"projectId\": \"uuid\" }", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true }, inputSchema: z.object({ projectId: z.string().uuid(), ...traceSchema }) }, async ({ projectId, correlationId }) => {
    assertToolPermission("project_save"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("project_delete", traceId, undefined, () => response({ projectId, deleted: deleteProject(projectId) }, traceId));
  });
  server.registerTool("project_archive", { title: "Archive Project", description: "📁 CONTEXT — Soft-archive a project (status → 'archived', record kept).\n\nExample: { \"projectId\": \"uuid\" }", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }, inputSchema: z.object({ projectId: z.string().uuid(), ...traceSchema }) }, async ({ projectId, correlationId }) => {
    assertToolPermission("project_save"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("project_archive", traceId, undefined, () => response({ projectId, archived: archiveProject(projectId) }, traceId));
  });
  server.registerTool("project_list", { title: "List Projects", description: "📁 CONTEXT (read) — List project records, paginated; filter by status (active|archived).\n\nExamples: { \"limit\": 20, \"offset\": 0 } · { \"status\": \"archived\" }", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }, inputSchema: z.object({ limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).default(0), status: z.enum(["active", "archived"]).optional(), ...traceSchema }) }, async ({ limit, offset, status, correlationId }) => {
    assertToolPermission("project_list"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("project_list", traceId, undefined, () => response(listProjects(limit, offset, status), traceId));
  });
  server.registerTool("memory_add", { title: "Add Memory", description: "🧠 MEMORY — Store a categorized note for a project or task (kind: decision, note, bug, architecture…). Content ≤64KB.\n\nExample: { \"kind\": \"decision\", \"content\": \"Using PostgreSQL\", \"projectId\": \"uuid\" }", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }, inputSchema: z.object({ taskId: z.string().uuid().optional(), projectId: z.string().uuid().optional(), kind: z.string().min(1).max(64), content: z.string().max(65536), ...traceSchema }) }, async ({ correlationId, ...input }) => {
    assertToolPermission("memory_add"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("memory_add", traceId, input.taskId, () => response({ id: saveMemoryItem(input) }, traceId));
  });
  server.registerTool("memory_list", { title: "List Memory", description: "🧠 MEMORY (read) — List stored memory notes; filter by taskId, projectId, or kind; paginated (limit/offset).\n\nExamples: { \"taskId\": \"uuid\" } · { \"kind\": \"decision\" } · { \"limit\": 20, \"offset\": 20 }", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }, inputSchema: z.object({ taskId: z.string().uuid().optional(), projectId: z.string().uuid().optional(), kind: z.string().optional(), limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).default(0), ...traceSchema }) }, async ({ correlationId, ...input }) => {
    assertToolPermission("memory_list"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("memory_list", traceId, input.taskId, () => response(listMemoryItems(input), traceId));
  });
  server.registerTool("memory_get", { title: "Get Memory", description: "🧠 MEMORY (read) — Fetch one memory record by id.\n\nExample: { \"memoryId\": 170 }", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }, inputSchema: z.object({ memoryId: z.number().int().positive(), ...traceSchema }) }, async ({ memoryId, correlationId }) => {
    assertToolPermission("memory_list"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("memory_get", traceId, undefined, () => response(getMemoryItem(memoryId), traceId));
  });
  server.registerTool("memory_delete", { title: "Delete Memory", description: "🧠 MEMORY — Permanently delete one memory record by id.\n\nExample: { \"memoryId\": 170 }", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true }, inputSchema: z.object({ memoryId: z.number().int().positive(), ...traceSchema }) }, async ({ memoryId, correlationId }) => {
    assertToolPermission("memory_add"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("memory_delete", traceId, undefined, () => response({ memoryId, deleted: deleteMemoryItem(memoryId) }, traceId));
  });

  // ---- Task Plan Extension ----
  server.registerTool("task_append_steps", { title: "Append Steps to Task", description: "🗂️ TASK — Add corrective steps to a failed/completed/cancelled task (completed steps stay immutable). New steps auto-chain from the last step.\n\nExample: { \"taskId\": \"uuid\", \"steps\": [{ \"action\": \"Fix implementation\", \"tool\": \"modify_file\", \"arguments\": { \"path\": \"src/app.ts\", \"search\": \"old\", \"replacement\": \"new\" } }] }", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false }, inputSchema: z.object({ taskId: z.string().uuid(), steps: z.array(stepSchema).min(1).max(50), ...traceSchema }) }, async ({ taskId, steps, correlationId }) => {
    assertToolPermission("task_run"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("task_append_steps", traceId, taskId, async () => {
      const plan = runtime.get(taskId);
      if (!plan) throw new Error("Task not found");
      if (plan.state !== "failed" && plan.state !== "completed" && plan.state !== "cancelled") {
        throw new Error(`Cannot append steps to task with state: ${plan.state}. Task must be failed, completed, or cancelled.`);
      }
      // Find the max existing step ID
      const maxId = Math.max(0, ...plan.steps.map((s: { id: number }) => s.id));
      // Assign new IDs and set dependsOn to the last existing step if not specified
      const lastStepId = maxId;
      const newSteps = steps.map((step, i) => ({
        ...step,
        id: maxId + i + 1,
        dependsOn: step.dependsOn && step.dependsOn.length > 0 ? step.dependsOn : (i === 0 && lastStepId > 0 ? [lastStepId] : []),
        status: "pending" as const,
      }));
      // Persist the new steps via task repository
      const { withAgentDatabase } = await import("../../core/memory/database.js");
      withAgentDatabase((db) => {
        const stmt = db.prepare(
          `INSERT INTO task_steps(task_id, step_id, step_order, action, tool, input, dependencies, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        const now = new Date().toISOString();
        newSteps.forEach((s, i) => {
          stmt.run(taskId, s.id, plan.steps.length + i, s.action, s.tool ?? null, JSON.stringify(s.arguments ?? {}), JSON.stringify(s.dependsOn ?? []), s.status, now, now);
        });
      });
      // Reload plan to reflect new steps
      const updated = runtime.get(taskId);
      return response({ taskId, appended: newSteps.length, totalSteps: updated?.steps?.length ?? plan.steps.length + newSteps.length, revision: (plan.revision ?? 1) + 1 }, traceId);
    });
  });

  // ---- Task Relationships ----
  server.registerTool("task_link", { title: "Link Tasks", description: "🗂️ TASK — Record a causal link between two tasks. Relations: repair, recovery, follow_up, validation, replay, rollback.\n\nExample: { \"sourceTaskId\": \"uuid\", \"targetTaskId\": \"uuid\", \"relation\": \"repair\" }", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }, inputSchema: z.object({ sourceTaskId: z.string().uuid(), targetTaskId: z.string().uuid(), relation: z.enum(["repair", "recovery", "follow_up", "validation", "replay", "rollback"]), ...traceSchema }) }, async ({ sourceTaskId, targetTaskId, relation, correlationId }) => {
    assertToolPermission("task_run"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("task_link", traceId, sourceTaskId, async () => {
      const { withAgentDatabase } = await import("../../core/memory/database.js");
      // Ensure task_links table exists
      withAgentDatabase((db) => db.prepare(`
        CREATE TABLE IF NOT EXISTS task_links (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_task_id TEXT NOT NULL,
          target_task_id TEXT NOT NULL,
          relation TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `).run());
      withAgentDatabase((db) => db.prepare(
        "INSERT INTO task_links(source_task_id, target_task_id, relation, created_at) VALUES (?, ?, ?, ?)"
      ).run(sourceTaskId, targetTaskId, relation, new Date().toISOString()));
      return response({ sourceTaskId, targetTaskId, relation, linked: true }, traceId);
    });
  });

  server.registerTool("task_links", { title: "Get Task Links", description: "🗂️ TASK (read) — Show a task's causal links: upstream (what triggered it) and downstream (what it triggered).\n\nExample: { \"taskId\": \"uuid\" }", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }, inputSchema: z.object({ taskId: z.string().uuid(), ...traceSchema }) }, async ({ taskId, correlationId }) => {
    assertToolPermission("task_list"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("task_links", traceId, taskId, async () => {
      const { withAgentDatabase } = await import("../../core/memory/database.js");
      // Ensure table exists
      withAgentDatabase((db) => db.prepare(`
        CREATE TABLE IF NOT EXISTS task_links (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_task_id TEXT NOT NULL,
          target_task_id TEXT NOT NULL,
          relation TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `).run());
      const upstream = withAgentDatabase((db) => db.prepare(
        "SELECT source_task_id, relation, created_at FROM task_links WHERE target_task_id = ?"
      ).all(taskId)) as Array<{ source_task_id: string; relation: string; created_at: string }>;
      const downstream = withAgentDatabase((db) => db.prepare(
        "SELECT target_task_id, relation, created_at FROM task_links WHERE source_task_id = ?"
      ).all(taskId)) as Array<{ target_task_id: string; relation: string; created_at: string }>;
      return response({ taskId, upstream, downstream }, traceId);
    });
  });

  // ---- Task Step Risk Preview ----
  server.registerTool("task_step_risks", { title: "Preview Step Risks", description: "🗂️ TASK (read) — Dry-run risk analysis: which planned steps will require approval before execution.\n\nClassifies the full policy posture per step: command permissions, OUTSIDE-WORKSPACE cwd (requires approval), mutating tools, destructive commands. Uses the same governance engine as task_run, so its verdicts match execution.\n\nExample: { \"steps\": [{ \"tool\": \"execute_command\", \"arguments\": { \"command\": \"git\", \"args\": [\"status\"], \"cwd\": \"D:/other/repo\" } }] }", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }, inputSchema: z.object({ steps: z.array(z.object({ tool: z.string(), arguments: z.record(z.string(), z.unknown()).default({}) })), ...traceSchema }) }, async ({ steps, correlationId }) => {
    assertToolPermission("task_list"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("task_step_risks", traceId, undefined, async () => {
      const { checkStepGovernance } = await import("../../core/governance/step-governance.js");
      const results = steps.map((s, i) => {
        const gov = checkStepGovernance({ id: i + 1, action: s.tool, tool: s.tool as any, arguments: s.arguments, status: "pending" });
        return { stepId: i + 1, tool: s.tool, risk: gov.risk, approvalRequired: gov.decision === "approval_required", reason: gov.reason };
      });
      return response(results, traceId);
    });
  });

  // ---- Task Snapshot / Rollback ----
  server.registerTool("task_snapshot", { title: "Task Snapshot", description: "🗂️ TASK — Capture a git snapshot (HEAD, branch, clean/dirty) of a workspace before running a task; snapshotId feeds task_rollback.\n\nExample: { \"cwd\": \"D:/Projects/my-app\" }", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }, inputSchema: z.object({ cwd: z.string().min(1), ...traceSchema }) }, async ({ cwd, correlationId }) => {
    assertToolPermission("task_snapshot"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("task_snapshot", traceId, undefined, async () => {
      policyDecisionPoint.assertAllowed({ tool: "task_snapshot", arguments: { cwd }, correlationId: traceId });
      const result = await captureTaskSnapshot(cwd, traceId);
      return response(result, traceId);
    });
  });

  server.registerTool("task_rollback", { title: "Task Rollback", description: "🗂️ TASK — DESTRUCTIVE: git reset --hard + clean to a pre-task snapshot. Wipes uncommitted changes and untracked files. Requires approval; cwd must match the snapshot's.\n\nExample: { \"snapshotId\": \"uuid\", \"cwd\": \"D:/Projects/my-app\" }", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false }, inputSchema: z.object({ snapshotId: z.string().uuid(), cwd: z.string().min(1), ...traceSchema }) }, async ({ snapshotId, cwd, correlationId }) => {
    assertToolPermission("task_rollback"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("task_rollback", traceId, undefined, async () => {
      policyDecisionPoint.assertAllowed({ tool: "task_rollback", arguments: { snapshotId, cwd }, correlationId: traceId });
      const result = await rollbackTaskSnapshot(snapshotId, cwd);
      return response(result, traceId);
    });
  });
}
