import { withAgentDatabase } from "./database.js";

/** Classify tool calls into categories for metric separation. */
const OBSERVABILITY_TOOLS = new Set(["agent_metrics", "task_report", "task_get", "task_list"]);
const ORCHESTRATION_TOOLS = new Set(["task_create", "task_run", "task_resume", "task_approve", "task_cancel", "task_replay"]);

type CallCategory = "workflow" | "observability" | "orchestration" | "governance";

function classifyCall(tool: string): CallCategory {
  if (OBSERVABILITY_TOOLS.has(tool)) return "observability";
  if (ORCHESTRATION_TOOLS.has(tool)) return "orchestration";
  return "workflow";
}

function record(tool: string, correlationId: string, taskId: string | undefined, status: "success" | "failed", startedAt: string, durationMs: number, error?: unknown): void {
  const category = classifyCall(tool);
  withAgentDatabase((db) => {
    // Ensure category column exists (migration)
    const cols = new Set((db.prepare("PRAGMA table_info(tool_calls)").all() as Array<{ name: string }>).map((c) => c.name));
    if (!cols.has("category")) {
      try { db.prepare("ALTER TABLE tool_calls ADD COLUMN category TEXT DEFAULT 'workflow'").run(); } catch { /* ignore */ }
    }
    db.prepare(`
      INSERT INTO tool_calls(correlation_id, task_id, tool, status, created_at, completed_at, duration_ms, error, category)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(correlationId, taskId ?? null, tool, status, startedAt, new Date().toISOString(), durationMs,
      error instanceof Error ? error.name : error === undefined ? null : "UnknownError", category);
  });
}

export async function auditToolCall<T>(
  tool: string,
  correlationId: string,
  taskId: string | undefined,
  operation: () => Promise<T> | T
): Promise<T> {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  try {
    const result = await operation();
    record(tool, correlationId, taskId, "success", startedAt, Math.max(0, Math.round(performance.now() - started)));
    return result;
  } catch (error) {
    record(tool, correlationId, taskId, "failed", startedAt, Math.max(0, Math.round(performance.now() - started)), error);
    throw error;
  }
}
