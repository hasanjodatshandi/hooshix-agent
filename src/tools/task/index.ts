import { z } from "zod";
import type { McpServer } from "../../adapters/inbound/mcp/legacy-sdk-bridge.js";
import { getTaskRuntimeService } from "../../core/runtime/composition-root.js";
import { auditToolCall } from "../../core/memory/tool-audit.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";
import { assertToolPermission } from "../../security/permission.js";
import { listMemoryItems, listProjects, saveMemoryItem, saveProject, getMemoryItem, deleteMemoryItem, updateMemoryItem, getProject, deleteProject, archiveProject, findTaskByIdempotencyKey } from "../../core/memory/task-repository.js";
import { getApprovalRequest } from "../../core/governance/approval-memory.js";
import { getTrustedInboundIdentity } from "../../core/runtime/r2-trusted-inbound-identity.js";


import { TOOL_NAMES, validateToolName } from "../../application/services/legacy-tool-orchestrator.js";
import { ReplayExecutor } from "../../core/trace/replay-executor.js";
import { AgentError } from "../../core/errors.js";
import { persistAppendedTaskSteps, persistTaskLink, getPersistedTaskLinks } from "../../adapters/outbound/persistence/sqlite/repositories/task-tool-persistence.adapter.js";
// Static, not dynamic: this module is already loaded by the agent loop for every
// task run, so a dynamic import here buys nothing and hides the dependency.
import { checkStepGovernance } from "../../core/governance/step-governance.js";

// R3: the runtime is a lazy singleton owned by the composition root (see
// getTaskRuntimeService), not this module — resolving it here keeps import-time
// side effects out of a module that only declares tool registrations.
const runtime = getTaskRuntimeService();
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

/**
 * The principal that owns project/memory rows this call touches. Every project
 * and memory record is scoped by owner; a missing trusted identity (local stdio
 * operator or internal caller) falls back to the shared "local-stdio" owner so
 * a single-operator install keeps working, while two HTTP principals can never
 * see each other's context.
 */
function currentPrincipalId(): string | undefined {
  const identity = getTrustedInboundIdentity();
  return identity.principal.origin === "local_stdio" ? undefined : identity.principal.id;
}

async function progress(context:unknown,value:number,total:number,message:string):Promise<void>{
  // SDK v2 context is transport-specific; progress is optional and must not
  // turn a successful durable Task operation into an error.
  const extra=context as {mcpReq?:{requestMeta?:{progressToken?:string|number};
    sendNotification?:(input:unknown)=>Promise<void>}};
  const token=extra.mcpReq?.requestMeta?.progressToken;
  if(token===undefined||!extra.mcpReq?.sendNotification)return;
  await extra.mcpReq.sendNotification({method:"notifications/progress",
    params:{progressToken:token,progress:value,total,message}}).catch(()=>{});
}

export function registerTaskTools(server: McpServer) {
  server.registerTool("task_create", { title: "Create Task", description: "🗂️ TASK — Persist an explicit multi-step plan. Lifecycle: task_create → task_run → (approval?) task_approve → task_resume → task_report.\n\nEach step: { id?, action, tool, arguments, dependsOn?, runWhen?, timeout? }.\n\nTEMPLATE VARIABLES pass output between steps: {{stepN.output.field}} · {{stepN.output}} · {{stepN.status}} · {{stepN.error}}\n\nExample:\n{ \"title\": \"Setup\", \"projectId\": \"uuid\", \"steps\": [\n  { \"action\": \"Create pkg\", \"tool\": \"create_file\", \"arguments\": { \"path\": \"package.json\", \"content\": \"{}\" } },\n  { \"action\": \"Install deps\", \"tool\": \"install_package\", \"arguments\": { \"manager\": \"npm\", \"name\": \"express\" }, \"dependsOn\": [1] }\n] }\n\nprojectId (optional) binds the task to a Project so task_list(projectId) finds it.\n\nretryPolicy: { maxTotalAttempts, maxConsecutiveFailures } limits re-runs. idempotencyKey deduplicates identical CREATES (same payload + owner + scope) — a changed payload with the same key is rejected, not merged.", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },    inputSchema: z.object({ title: z.string().min(1).max(200), projectId: z.string().uuid().optional(), description: z.string().max(4000).optional(), steps: z.array(stepSchema).min(1).max(100), retryPolicy: z.object({ maxTotalAttempts: z.number().int().min(1).max(100).optional(), maxConsecutiveFailures: z.number().int().min(1).max(50).optional() }).optional(), idempotencyKey: z.string().max(200).optional(), ...traceSchema }) }, async ({ title, projectId, description, steps, retryPolicy, idempotencyKey, correlationId }) => {
    assertToolPermission("task_create"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("task_create", traceId, undefined, () => {
      // Only the runtime may decide whether a key is an identical request:
      // a bare key lookup cannot authorize a changed payload or a new scope.
      const priorId=idempotencyKey?findTaskByIdempotencyKey(idempotencyKey):undefined;
      const created=runtime.create({title,projectId,description,steps:steps.map(step=>({...step,status:"pending" as const})),
        retryPolicy,idempotencyKey,correlationId:traceId});
      return response(priorId===created.id
        ?{id:created.id,idempotent:true,message:"Existing task returned for this idempotency key"}
        :created,traceId);
    });
  });
  server.registerTool("task_get", { title: "Get Task", description: "🗂️ TASK (read) — Full task object: state, steps with statuses/outputs/errors, pending approval info.\n\nExample: { \"taskId\": \"550e8400-...\" }", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }, inputSchema: z.object({ taskId: z.string().uuid(), ...traceSchema }) }, async ({ taskId, correlationId }) => {
    assertToolPermission("task_get"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("task_get", traceId, taskId, () => response(runtime.get(taskId), traceId));
  });
  server.registerTool("task_list", { title: "List Tasks", description: "🗂️ TASK (read) — Recent task summaries: ids, titles, statuses. limit 1-100 (default 50).\n\nprojectId (optional) lists only the tasks bound to that Project.\n\nExamples: { \"limit\": 10 } · { \"projectId\": \"uuid\" }", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }, inputSchema: z.object({ limit: z.number().int().min(1).max(100).default(50), projectId: z.string().uuid().optional(), ...traceSchema }) }, async ({ limit, projectId, correlationId }) => {
    assertToolPermission("task_list"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("task_list", traceId, undefined, () => response(runtime.list(limit, projectId), traceId));
  });
  server.registerTool("task_run", { title: "Run Task", description: "🗂️ TASK — Execute a task's next unfinished steps sequentially. Templates ({{stepN.*}}) resolve automatically; transient failures retry with backoff; high-risk steps pause for approval. Re-running a completed or cancelled task is a no-op; re-running a FAILED task re-executes its unfinished steps.\n\nExample: { \"taskId\": \"550e8400-...\" } · maxRecovery 0-3 (default 1).", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }, inputSchema: z.object({ taskId: z.string().uuid(), maxRecovery: z.number().int().min(0).max(3).default(1), ...traceSchema }) }, async ({ taskId, maxRecovery, correlationId }, extra) => {
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
  server.registerTool("task_reconcile", {
    title: "Reconcile Interrupted Task Outcome",
    description: "🗂️ TASK — Audit evidence for an outcome_unknown step (default) or explicitly apply an independently verified operator decision. Required: taskId, stepId and evidence (12-4000 chars) describing what was observed. decision=confirmed_succeeded/confirmed_failed requires an independent completed read-only verification Task with the same owner (same principal AND session) passed as verificationTaskId; safe_to_retry additionally requires a durable idempotent create_file receipt. Original tool result stays unknown and no automatic replay occurs.\n\nExample: { \"taskId\": \"uuid\", \"stepId\": 2, \"finding\": \"effect_observed\", \"evidence\": \"Ran git status — the file is staged as expected.\" }",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    inputSchema: z.object({
      taskId: z.string().uuid(),
      stepId: z.number().int().positive(),
      finding: z.enum(["effect_observed", "effect_not_observed", "undetermined"]).default("undetermined"),
      decision: z.enum(["confirmed_succeeded","confirmed_failed","safe_to_retry",
        "still_unknown","manual_intervention_required"]).optional(),
      evidence: z.string().min(12).max(4000),
      verificationTaskId: z.string().uuid().optional(),
      ...traceSchema
    })
  }, async ({ taskId, stepId, finding, decision, evidence, verificationTaskId, correlationId }) => {
    assertToolPermission("task_run");
    const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("task_reconcile", traceId, taskId, () =>
      response(runtime.reconcile({taskId,stepId,finding,decision,evidence,verificationTaskId}), traceId));
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
  server.registerTool("project_save", { title: "Save Project", description: "📁 CONTEXT — Create or update a project record (name, path, description, last/next action). Path is canonicalized and REQUIRED on both create and update. No id = create (fails if path taken), with id = update. Duplicate names are rejected on both paths.\n\nExamples: { \"name\": \"My API\", \"path\": \"D:/Projects/my-api\" } · { \"id\": \"uuid\", \"name\": \"New Name\", \"path\": \"D:/Projects/my-api\" }", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }, inputSchema: z.object({ id: z.string().uuid().optional(), name: z.string().min(1).max(200), path: z.string(), description: z.string().max(4000).optional(), lastAction: z.string().max(1000).optional(), nextAction: z.string().max(1000).optional(), ...traceSchema })  }, async ({ correlationId, ...input }) => {
    assertToolPermission("project_save"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("project_save", traceId, undefined, () => response({ id: saveProject({ ...input, principalId: currentPrincipalId() }) }, traceId));
  });
  server.registerTool("project_get", { title: "Get Project", description: "📁 CONTEXT (read) — Fetch one project record by id.\n\nExample: { \"projectId\": \"uuid\" }", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }, inputSchema: z.object({ projectId: z.string().uuid(), ...traceSchema }) }, async ({ projectId, correlationId }) => {
    assertToolPermission("project_list"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("project_get", traceId, undefined, () => response(getProject(projectId, currentPrincipalId()), traceId));
  });
  server.registerTool("project_delete", { title: "Delete Project", description: "📁 CONTEXT — Permanently delete a project record by id.\n\nExample: { \"projectId\": \"uuid\" }", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true }, inputSchema: z.object({ projectId: z.string().uuid(), ...traceSchema }) }, async ({ projectId, correlationId }) => {
    assertToolPermission("project_save"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("project_delete", traceId, undefined, () => response({ projectId, deleted: deleteProject(projectId, currentPrincipalId()) }, traceId));
  });
  server.registerTool("project_archive", { title: "Archive Project", description: "📁 CONTEXT — Soft-archive a project (status → 'archived', record kept).\n\nExample: { \"projectId\": \"uuid\" }", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }, inputSchema: z.object({ projectId: z.string().uuid(), ...traceSchema }) }, async ({ projectId, correlationId }) => {
    assertToolPermission("project_save"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("project_archive", traceId, undefined, () => response({ projectId, archived: archiveProject(projectId, currentPrincipalId()) }, traceId));
  });
  server.registerTool("project_list", { title: "List Projects", description: "📁 CONTEXT (read) — List project records, paginated; filter by status (active|archived).\n\nExamples: { \"limit\": 20, \"offset\": 0 } · { \"status\": \"archived\" }", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }, inputSchema: z.object({ limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).default(0), status: z.enum(["active", "archived"]).optional(), ...traceSchema }) }, async ({ limit, offset, status, correlationId }) => {
    assertToolPermission("project_list"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("project_list", traceId, undefined, () => response(listProjects(limit, offset, status, currentPrincipalId()), traceId));
  });
  server.registerTool("memory_add", { title: "Add Memory", description: "🧠 MEMORY — Store a categorized note for a project or task (kind: decision, note, bug, architecture…). Content is a plain STRING ≤512KB. Both taskId and projectId are optional — omitting both stores a global note.\n\nEmpty Content: Returns MEMORY_CONTENT_REQUIRED error.\n\nDuplicate Detection: If content is identical to existing memory for same task/project, allows save but returns { duplicateOf: existingId } in response.\n\nExample: { \"kind\": \"decision\", \"content\": \"Using PostgreSQL\", \"projectId\": \"uuid\" }", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }, inputSchema: z.object({ taskId: z.string().uuid().optional(), projectId: z.string().uuid().optional(), kind: z.string().min(1).max(64), content: z.string().max(524288), ...traceSchema }) }, async ({ correlationId, ...input }) => {
    assertToolPermission("memory_add"); const traceId = resolveCorrelationId(correlationId);
    const principalId = currentPrincipalId();
    // Empty content check
    if (!input.content || input.content.trim().length === 0) {
      throw new AgentError("MEMORY_CONTENT_REQUIRED", "Memory content is required");
    }
    // Duplicate detection: check for identical content in same task/project.
    const existing = listMemoryItems({ taskId: input.taskId, projectId: input.projectId, limit: 100, principalId });
    const duplicate = existing.items.find((item) => JSON.stringify(item.content) === JSON.stringify(input.content));
    const id = saveMemoryItem({ ...input, principalId });
    return auditToolCall("memory_add", traceId, input.taskId, () => response({ id, duplicateOf: duplicate?.id ?? null }, traceId));
  });
  server.registerTool("memory_list", { title: "List Memory", description: "🧠 MEMORY (read) — List stored memory notes; filter by taskId, projectId, or kind; paginated (limit/offset).\n\nExamples: { \"taskId\": \"uuid\" } · { \"kind\": \"decision\" } · { \"limit\": 20, \"offset\": 20 }", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }, inputSchema: z.object({ taskId: z.string().uuid().optional(), projectId: z.string().uuid().optional(), kind: z.string().optional(), limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).default(0), ...traceSchema }) }, async ({ correlationId, ...input }) => {
    assertToolPermission("memory_list"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("memory_list", traceId, input.taskId, () => response(listMemoryItems({ ...input, principalId: currentPrincipalId() }), traceId));
  });
  server.registerTool("memory_get", { title: "Get Memory", description: "🧠 MEMORY (read) — Fetch one memory record by id.\n\nExample: { \"memoryId\": 170 }", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }, inputSchema: z.object({ memoryId: z.number().int().positive(), ...traceSchema }) }, async ({ memoryId, correlationId }) => {
    assertToolPermission("memory_list"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("memory_get", traceId, undefined, () => response(getMemoryItem(memoryId, currentPrincipalId()), traceId));
  });
  server.registerTool("memory_delete", { title: "Delete Memory", description: "🧠 MEMORY — Permanently delete one memory record by id.\n\nExample: { \"memoryId\": 170 }", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true }, inputSchema: z.object({ memoryId: z.number().int().positive(), ...traceSchema }) }, async ({ memoryId, correlationId }) => {
    assertToolPermission("memory_add"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("memory_delete", traceId, undefined, () => response({ memoryId, deleted: deleteMemoryItem(memoryId, currentPrincipalId()) }, traceId));
  });
  server.registerTool("memory_update", { title: "Update Memory", description: "🧠 MEMORY — Update an existing memory record's kind and/or content in place. Use it for mutable current state (progress, next action, status) instead of deleting and re-adding. Content is a plain STRING (≤512KB); store structured state as a JSON string. Provide at least one of kind/content.\n\nExample: { \"memoryId\": 170, \"kind\": \"progress\", \"content\": \"{\\\"status\\\":\\\"greenfield-ready\\\",\\\"nextAction\\\":\\\"scaffold the API\\\"}\" }", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }, inputSchema: z.object({ memoryId: z.number().int().positive(), kind: z.string().min(1).max(64).optional(), content: z.string().max(524288).optional(), ...traceSchema }) }, async ({ memoryId, kind, content, correlationId }) => {
    assertToolPermission("memory_add"); const traceId = resolveCorrelationId(correlationId);
    if (kind === undefined && content === undefined) throw new AgentError("INVALID_ARGUMENT", "Provide at least one of kind or content");
    if (content !== undefined && content.trim().length === 0) throw new AgentError("MEMORY_CONTENT_REQUIRED", "Memory content is required");
    return auditToolCall("memory_update", traceId, undefined, () => response(updateMemoryItem({ id: memoryId, kind, content, principalId: currentPrincipalId() }), traceId));
  });

  // ---- Task Plan Extension ----
  server.registerTool("task_append_steps", { title: "Append Steps to Task", description: "🗂️ TASK — Append corrective steps ONLY to a failed Task with no unresolved effect. Completed/cancelled Tasks are terminal and cannot reopen. New steps auto-chain; use runWhen=always for a corrective step following a failed dependency.\n\nExample: { \"taskId\": \"uuid\", \"steps\": [{ \"action\": \"Fix implementation\", \"tool\": \"modify_file\", \"arguments\": { \"path\": \"src/app.ts\", \"search\": \"old\", \"replacement\": \"new\" } }] }", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false }, inputSchema: z.object({ taskId: z.string().uuid(), steps: z.array(stepSchema).min(1).max(50), ...traceSchema }) }, async ({ taskId, steps, correlationId }) => {
    assertToolPermission("task_run"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("task_append_steps", traceId, taskId, async () => {
      const plan = runtime.get(taskId);
      if (!plan) throw new Error("Task not found");
      if (plan.state === "completed" || plan.state === "cancelled") throw new Error("terminal_task_append_forbidden");
      if (plan.state !== "failed") throw new Error("task_append_requires_failed_state");
      if (plan.steps.some(step => step.status === "outcome_unknown" || step.status === "running" || step.status === "pending_approval"))
        throw new Error("task_append_requires_reconciliation");
      const previousState = plan.state;
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
      // The outbound adapter atomically validates the state/revision and inserts
      // corrective steps + the Task transition. No separate stale plan save.
      const newRevision=persistAppendedTaskSteps(taskId,plan.steps.length,newSteps,plan.revision??0);
      const updated=runtime.get(taskId);
      return response({taskId,appended:newSteps.length,
        totalSteps:updated?.steps.length??plan.steps.length+newSteps.length,
        revision:newRevision,previousState,newState:"planning"},traceId);
    });
  });

  // ---- Task Relationships ----
  server.registerTool("task_link", { title: "Link Tasks", description: "🗂️ TASK — Record a causal link between two tasks. Relations: repair, recovery, follow_up, validation, replay, rollback.\n\nExample: { \"sourceTaskId\": \"uuid\", \"targetTaskId\": \"uuid\", \"relation\": \"repair\" }", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }, inputSchema: z.object({ sourceTaskId: z.string().uuid(), targetTaskId: z.string().uuid(), relation: z.enum(["repair", "recovery", "follow_up", "validation", "replay", "rollback"]), ...traceSchema }) }, async ({ sourceTaskId, targetTaskId, relation, correlationId }) => {
    assertToolPermission("task_run"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("task_link", traceId, sourceTaskId, async () => {
      persistTaskLink(sourceTaskId, targetTaskId, relation);
      return response({ sourceTaskId, targetTaskId, relation, linked: true }, traceId);
    });
  });

  server.registerTool("task_links", { title: "Get Task Links", description: "🗂️ TASK (read) — Show a task's causal links: upstream (what triggered it) and downstream (what it triggered).\n\nExample: { \"taskId\": \"uuid\" }", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }, inputSchema: z.object({ taskId: z.string().uuid(), ...traceSchema }) }, async ({ taskId, correlationId }) => {
    assertToolPermission("task_list"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("task_links", traceId, taskId, async () => {
      // Enforce task ownership before exposing the link graph: link rows are
      // keyed by task id only, so without this a caller could enumerate
      // another principal's task ids (though never their contents).
      const plan = runtime.get(taskId);
      if (!plan) return response({ taskId, upstream: [], downstream: [] }, traceId);
      const { upstream, downstream } = getPersistedTaskLinks(taskId);
      return response({ taskId, upstream, downstream }, traceId);
    });
  });

  // ---- Task Step Risk Preview ----
  server.registerTool("task_step_risks", { title: "Preview Step Risks", description: "🗂️ TASK (read) — Dry-run risk analysis: which planned steps will require approval before execution.\n\nClassifies the full policy posture per step: command permissions, OUTSIDE-WORKSPACE cwd (requires approval), mutating tools, destructive commands. Uses the same governance engine as task_run, so its verdicts match execution.\n\nExample: { \"steps\": [{ \"tool\": \"execute_command\", \"arguments\": { \"command\": \"git\", \"args\": [\"status\"], \"cwd\": \"D:/other/repo\" } }] }", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }, inputSchema: z.object({ steps: z.array(z.object({ tool: z.string(), arguments: z.record(z.string(), z.unknown()).default({}) })), ...traceSchema }) }, async ({ steps, correlationId }) => {
    assertToolPermission("task_list"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("task_step_risks", traceId, undefined, async () => {
      const results = steps.map((s, i) => {
        const tool = validateToolName(s.tool);
        const gov = checkStepGovernance({ id: i + 1, action: tool, tool, arguments: s.arguments, status: "pending" });
        return { stepId: i + 1, tool, risk: gov.risk, decision: gov.decision, blocked: gov.decision === "blocked", approvalRequired: gov.decision === "approval_required", reason: gov.reason };
      });
      return response(results, traceId);
    });
  });

  // R2 schema-only snapshot/rollback: effects are authorized and dispatched through the common handler.
  server.registerTool("task_snapshot", { title: "Task Snapshot", description: "🗂️ TASK — Capture a git snapshot of a CLEAN workspace (HEAD + branch) before running a task; snapshotId feeds task_rollback. Refuses a dirty worktree, a non-git directory, an empty repo (no commits) and a cwd that is not the repository root — check git_status first.\n\nExample: { \"cwd\": \"D:/Projects/my-app\" }", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }, inputSchema: z.object({ cwd: z.string().min(1), ...traceSchema }) }, async () => { throw new Error("r2_legacy_direct_callback_retired"); });
  server.registerTool("task_rollback", { title: "Task Rollback", description: "🗂️ TASK — DESTRUCTIVE: git reset --hard + clean to a pre-task snapshot. Wipes uncommitted changes and untracked files. Requires approval; cwd must match the snapshot's and the current branch must match the snapshot's branch. Only a task snapshot id works — use restore_file for individual file backups.\n\nExample: { \"snapshotId\": \"uuid\", \"cwd\": \"D:/Projects/my-app\" }", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false }, inputSchema: z.object({ snapshotId: z.string().uuid(), cwd: z.string().min(1), ...traceSchema }) }, async () => { throw new Error("r2_legacy_direct_callback_retired"); });
}