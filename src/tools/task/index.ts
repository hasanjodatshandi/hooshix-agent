import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createTaskRuntimeService } from "../../core/runtime/composition-root.js";
import { auditToolCall } from "../../core/memory/tool-audit.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";
import { assertToolPermission } from "../../security/permission.js";
import { listMemoryItems, listProjects, saveMemoryItem, saveProject } from "../../core/memory/task-repository.js";
import { validateWorkspace } from "../../security/workspace-guard.js";
import { TOOL_NAMES } from "../../core/orchestrator/tool-orchestrator.js";
import { ReplayExecutor } from "../../core/trace/replay-executor.js";

const runtime = createTaskRuntimeService();
const traceSchema = { correlationId: z.string().min(1).optional() };
const toolName = z.enum(TOOL_NAMES);
const stepSchema = z.object({
  id: z.number().int().positive().optional(),
  action: z.string().min(1).max(500),
  tool: toolName,
  arguments: z.record(z.string(), z.unknown()).default({}),
  dependsOn: z.array(z.number().int().positive()).default([])
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
  server.registerTool("task_create", { title: "Create Task", description: "Persist an explicit JSON plan prepared by ChatGPT. Each step has an action, tool, and optional arguments.\n\nTEMPLATE VARIABLES - Pass output between steps:\n  {{stepN.output.field}}  - Access a field from step N's output\n  {{stepN.output}}        - Access the entire output\n  {{stepN.status}}        - Access step N's status\n  {{stepN.error}}         - Access step N's error message\n\nExample with template variables:\n{ \"title\": \"Delete and restore\", \"steps\": [\n  { \"action\": \"Delete file\", \"tool\": \"delete_file\", \"arguments\": { \"path\": \"test.txt\" } },\n  { \"action\": \"Restore file\", \"tool\": \"restore_file\", \"arguments\": { \"backupId\": \"{{step1.output.backupId}}\" } }\n]}\n\nBasic example:\n{ \"title\": \"Setup project\", \"steps\": [\n  { \"action\": \"Create package.json\", \"tool\": \"create_file\", \"arguments\": { \"path\": \"package.json\", \"content\": \"{}\" } },\n  { \"action\": \"Install dependencies\", \"tool\": \"install_package\", \"arguments\": { \"manager\": \"npm\", \"name\": \"express\" } }\n]}\n\nAvailable tools: get_system_info, agent_metrics, set_workspace, get_workspace, list_directory, read_file, write_file, create_file, modify_file, delete_file, restore_file, search_files, execute_command, git_status, git_diff, git_clone, git_commit, git_branch, git_checkout, install_package, remove_package, update_package.", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }, inputSchema: z.object({ title: z.string().min(1).max(200), description: z.string().max(4000).optional(), steps: z.array(stepSchema).min(1).max(100), ...traceSchema }) }, async ({ title, description, steps, correlationId }) => {
    assertToolPermission("task_create");
    const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("task_create", traceId, undefined, () => response(runtime.create({ title, description, steps: steps.map((step) => ({ ...step, status: "pending" as const })), correlationId: traceId }), traceId));
  });
  server.registerTool("task_get", { title: "Get Task", description: "Load one persisted task and its steps. Returns the full task object with step statuses.\n\nExample: { \"tool\": \"task_get\", \"arguments\": { \"taskId\": \"550e8400-e29b-41d4-a716-446655440000\" } }", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }, inputSchema: z.object({ taskId: z.string().uuid(), ...traceSchema }) }, async ({ taskId, correlationId }) => {
    assertToolPermission("task_get"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("task_get", traceId, taskId, () => response(runtime.get(taskId), traceId));
  });
  server.registerTool("task_list", { title: "List Tasks", description: "List persisted tasks. Returns task summaries with IDs, titles, and statuses.\n\nExample: { \"tool\": \"task_list\", \"arguments\": { \"limit\": 10 } }\n\nDefault limit: 50, max: 100.", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }, inputSchema: z.object({ limit: z.number().int().min(1).max(100).default(50), ...traceSchema }) }, async ({ limit, correlationId }) => {
    assertToolPermission("task_list"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("task_list", traceId, undefined, () => response(runtime.list(limit), traceId));
  });
  server.registerTool("task_run", { title: "Run Task", description: "Execute the next unfinished steps of a persisted task. Steps run sequentially. Template variables ({{stepN.output.field}}) are resolved automatically before each step. If a step fails, recovery is attempted.\n\nExample: { \"tool\": \"task_run\", \"arguments\": { \"taskId\": \"550e8400-e29b-41d4-a716-446655440000\" } }\n\nOptional maxRecovery (0-3, default 1): number of recovery attempts on failure.", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }, inputSchema: z.object({ taskId: z.string().uuid(), maxRecovery: z.number().int().min(0).max(3).default(1), ...traceSchema }) }, async ({ taskId, maxRecovery, correlationId }, extra) => {
    assertToolPermission("task_run"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("task_run", traceId, taskId, async () => {
      await progress(extra, 0, 1, "Task started");
      const value = await runtime.run(taskId, maxRecovery);
      await progress(extra, 1, 1, `Task ${value.status}`);
      return response(value, traceId);
    });
  });
  server.registerTool("task_approve", { title: "Approve Task Step", description: "Approve one pending high-risk task step. When a step requires approval, it pauses and returns an approvalId.\n\nExample: { \"tool\": \"task_approve\", \"arguments\": { \"approvalId\": 42 } }\n\nThe approvalId is returned when a task pauses for approval.", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false }, inputSchema: z.object({ approvalId: z.number().int().positive(), ...traceSchema }) }, async ({ approvalId, correlationId }) => {
    assertToolPermission("task_approve"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("task_approve", traceId, undefined, () => response({ approvalId, approved: runtime.approve(approvalId) }, traceId));
  });
  server.registerTool("task_resume", { title: "Resume Task", description: "Consume an approval and resume its exact paused step. Use after task_approve.\n\nExample: { \"tool\": \"task_resume\", \"arguments\": { \"approvalId\": 42 } }", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false }, inputSchema: z.object({ approvalId: z.number().int().positive(), ...traceSchema }) }, async ({ approvalId, correlationId }) => {
    assertToolPermission("task_resume"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("task_resume", traceId, undefined, async () => response(await runtime.resume(approvalId), traceId));
  });
  server.registerTool("task_report", { title: "Task Report", description: "Return plan state and unified execution/recovery timeline. Shows each step's status, timing, and any errors.\n\nExample: { \"tool\": \"task_report\", \"arguments\": { \"taskId\": \"550e8400-e29b-41d4-a716-446655440000\" } }", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }, inputSchema: z.object({ taskId: z.string().uuid(), ...traceSchema }) }, async ({ taskId, correlationId }) => {
    assertToolPermission("task_report"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("task_report", traceId, taskId, () => response(runtime.report(taskId), traceId));
  });
  server.registerTool("task_replay", { title: "Replay Task", description: "Recreate a task context, execute its steps, and compare step states. Useful for testing reproducibility.\n\nExample: { \"tool\": \"task_replay\", \"arguments\": { \"taskId\": \"550e8400-e29b-41d4-a716-446655440000\" } }\n\nOptional allowMutations (default false): set true to allow file changes during replay.", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }, inputSchema: z.object({ taskId: z.string().uuid(), allowMutations: z.boolean().default(false), ...traceSchema }) }, async ({ taskId, allowMutations, correlationId }) => {
    assertToolPermission("task_replay"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("task_replay", traceId, taskId, async () => response(await new ReplayExecutor(runtime).replay(taskId, allowMutations), traceId));
  });
  server.registerTool("task_cancel", { title: "Cancel Task", description: "Cancel a task that is not currently executing a tool call. Fails if a step is actively running.\n\nExample: { \"tool\": \"task_cancel\", \"arguments\": { \"taskId\": \"550e8400-e29b-41d4-a716-446655440000\" } }", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true }, inputSchema: z.object({ taskId: z.string().uuid(), ...traceSchema }) }, async ({ taskId, correlationId }) => {
    assertToolPermission("task_cancel"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("task_cancel", traceId, taskId, () => response({ taskId, cancelled: runtime.cancel(taskId) }, traceId));
  });
  server.registerTool("project_save", { title: "Save Project", description: "Create or update local project context. Stores project metadata for later retrieval.\n\nExample:\n{ \"name\": \"My API\", \"path\": \"/workspace/my-api\", \"description\": \"REST API with Express\", \"lastAction\": \"Added auth middleware\", \"nextAction\": \"Write tests\" }\n\nIf id is provided, updates existing project. Otherwise creates new.", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }, inputSchema: z.object({ id: z.string().uuid().optional(), name: z.string().min(1).max(200), path: z.string(), description: z.string().max(4000).optional(), lastAction: z.string().max(1000).optional(), nextAction: z.string().max(1000).optional(), ...traceSchema }) }, async ({ correlationId, ...input }) => {
    assertToolPermission("project_save"); const traceId = resolveCorrelationId(correlationId); input.path = validateWorkspace(input.path);
    return auditToolCall("project_save", traceId, undefined, () => response({ id: saveProject(input) }, traceId));
  });
  server.registerTool("project_list", { title: "List Projects", description: "List stored project contexts. Returns project summaries with IDs, names, and descriptions.\n\nExample: { \"tool\": \"project_list\", \"arguments\": { \"limit\": 10 } }", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }, inputSchema: z.object({ limit: z.number().int().min(1).max(100).default(50), ...traceSchema }) }, async ({ limit, correlationId }) => {
    assertToolPermission("project_list"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("project_list", traceId, undefined, () => response(listProjects(limit), traceId));
  });
  server.registerTool("memory_add", { title: "Add Memory", description: "Store project or task context supplied by ChatGPT. Use kind to categorize (e.g., \"decision\", \"note\", \"bug\", \"architecture\").\n\nExample:\n{ \"kind\": \"decision\", \"content\": \"Using PostgreSQL instead of MongoDB for the main database\", \"projectId\": \"uuid\" }\n\nOptional: taskId to associate with a specific task.", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }, inputSchema: z.object({ taskId: z.string().uuid().optional(), projectId: z.string().uuid().optional(), kind: z.string().min(1).max(64), content: z.string().max(65536), ...traceSchema }) }, async ({ correlationId, ...input }) => {
    assertToolPermission("memory_add"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("memory_add", traceId, input.taskId, () => response({ id: saveMemoryItem(input) }, traceId));
  });
  server.registerTool("memory_list", { title: "List Memory", description: "List stored project or task context. Filter by taskId or projectId.\n\nExamples:\n  { \"tool\": \"memory_list\", \"arguments\": { \"projectId\": \"uuid\" } }             — list project memory\n  { \"tool\": \"memory_list\", \"arguments\": { \"taskId\": \"uuid\" } }                — list task memory\n  { \"tool\": \"memory_list\", \"arguments\": {} }                                         — list all memory", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }, inputSchema: z.object({ taskId: z.string().uuid().optional(), projectId: z.string().uuid().optional(), limit: z.number().int().min(1).max(100).default(50), ...traceSchema }) }, async ({ correlationId, ...input }) => {
    assertToolPermission("memory_list"); const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("memory_list", traceId, input.taskId, () => response(listMemoryItems(input), traceId));
  });
}
