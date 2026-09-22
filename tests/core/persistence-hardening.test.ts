import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { backupAgentDatabase, cleanupAgentData, withAgentDatabase } from "../../src/core/memory/database.js";
import { createTaskPlan } from "../../src/core/planner/task-planner.js";
import { getTaskPlan, saveTaskPlan } from "../../src/core/memory/task-repository.js";

describe("persistence hardening", () => {
  it("records ordered schema migrations and creates a consistent backup", async () => {
    const versions = withAgentDatabase((db) => db.prepare("SELECT version FROM schema_migrations ORDER BY version").all()) as Array<{ version: number }>;
    expect(versions.map((row) => row.version)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    const destination = path.resolve("data/test-backups/agent.db.bak");
    try {
      expect(await backupAgentDatabase(destination)).toBe(destination);
      const stat = await fs.stat(destination);
      expect(stat.size).toBeGreaterThan(0);
    } finally {
      await fs.rm(path.dirname(destination), { recursive: true, force: true });
    }
  });

  it("migration 9 persists exact, expiring, single-use approval bindings",()=>{
    withAgentDatabase(db=>{
      const columns=new Set((db.prepare("PRAGMA table_info(approval_requests)").all() as Array<{name:string}>).map(row=>row.name));
      for(const column of ["tool_id","request_fingerprint","principal_id","session_id","expires_at","dispatched_at"])
        expect(columns.has(column),column).toBe(true);
    });
  });

  it("migration 7 owns the durable task contract schema", () => {
    withAgentDatabase((db) => {
      const taskColumns = new Set((db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>).map((row) => row.name));
      const stepColumns = new Set((db.prepare("PRAGMA table_info(task_steps)").all() as Array<{ name: string }>).map((row) => row.name));
      const backupColumns = new Set((db.prepare("PRAGMA table_info(file_backups)").all() as Array<{ name: string }>).map((row) => row.name));
      const projectColumns = new Set((db.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>).map((row) => row.name));
      const toolCallColumns = new Set((db.prepare("PRAGMA table_info(tool_calls)").all() as Array<{ name: string }>).map((row) => row.name));
      const recoveryColumns = new Set((db.prepare("PRAGMA table_info(recovery_events)").all() as Array<{ name: string }>).map((row) => row.name));
      for (const name of ["last_heartbeat", "execution_context", "max_recovery", "retry_policy", "total_run_count", "idempotency_key"]) expect(taskColumns.has(name)).toBe(true);
      for (const name of ["error_type", "run_when", "step_timeout_ms", "attempts", "failed_attempts", "attempt_history", "template_arguments"]) expect(stepColumns.has(name)).toBe(true);
      expect(backupColumns.has("file_revision")).toBe(true);
      expect(projectColumns.has("status")).toBe(true);
      expect(toolCallColumns.has("category")).toBe(true);
      expect(recoveryColumns.has("task_id")).toBe(true);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='task_links'").get()).toBeTruthy();
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_tasks_idempotency_key'").get()).toBeTruthy();
    });
  });

  it("persists step errorType across full task-plan saves", () => {
    const plan = createTaskPlan("persist error type", [
      { action: "interrupted mutation", tool: "execute_command", arguments: { command: "node", args: ["--version"] }, status: "outcome_unknown" },
    ]);
    plan.steps[0].status = "outcome_unknown";
    plan.steps[0].error = "Mutation result unknown after crash";
    plan.steps[0].errorType = "OUTCOME_UNKNOWN";
    plan.state = "failed";
    saveTaskPlan(plan, "failed");

    const loaded = getTaskPlan(plan.id);
    expect(loaded?.steps[0].status).toBe("outcome_unknown");
    expect(loaded?.steps[0].errorType).toBe("OUTCOME_UNKNOWN");
  });

  it("deletes only expired terminal operational data", () => {
    withAgentDatabase((db) => {
      const old = "2000-01-01T00:00:00.000Z";
      db.prepare("INSERT INTO tool_calls(correlation_id, tool, status, created_at) VALUES ('old', 'read_file', 'success', ?)").run(old);
      db.prepare("INSERT INTO recovery_events(recovery_id, correlation_id, action, reason, retry_count, started_at, status) VALUES ('old-r', 'old', 'retry', 'x', 1, ?, 'completed')").run(old);
    });
    expect(cleanupAgentData(1)).toMatchObject({ toolCalls: 1, recoveryEvents: 1 });
  });
});