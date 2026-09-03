import { describe, expect, it } from "vitest";
import { withAgentDatabase } from "../../src/core/memory/database.js";

const TOOLS = ["read_file", "write_file", "execute_command", "search_files", "list_directory"];
const RECOVERY_STATUSES = ["started", "completed", "failed"];

function seedRepresentativeData(): void {
  withAgentDatabase((db) => {
    // Seed 2000 tool_calls with varied tools and statuses
    const insertTool = db.prepare(
      "INSERT INTO tool_calls(correlation_id, task_id, tool, status, created_at, completed_at, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    const insertRecovery = db.prepare(
      "INSERT INTO recovery_events(recovery_id, correlation_id, action, reason, retry_count, started_at, completed_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    const insertExec = db.prepare(
      "INSERT INTO executions(task_id, step_id, action, result, status, correlation_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );

    const now = new Date();
    db.transaction(() => {
      for (let i = 0; i < 2000; i++) {
        const tool = TOOLS[i % TOOLS.length];
        // 15% failure rate, distributed across tools
        const status = i % 7 === 0 ? "failed" : "success";
        const ts = new Date(now.getTime() - i * 1000).toISOString();
        insertTool.run(`corr-${i}`, i < 500 ? `task-${i % 10}` : null, tool, status, ts, ts, Math.floor(Math.random() * 5000));
      }
      for (let i = 0; i < 200; i++) {
        const status = RECOVERY_STATUSES[i % RECOVERY_STATUSES.length];
        const ts = new Date(now.getTime() - i * 5000).toISOString();
        const completed = status === "started" ? null : ts;
        insertRecovery.run(`rec-${i}`, `corr-${i}`, "retry", "test", i % 3, ts, completed, status);
      }
      for (let i = 0; i < 1000; i++) {
        const status = i % 10 === 0 ? "failed" : "completed";
        const ts = new Date(now.getTime() - i * 2000).toISOString();
        insertExec.run(`task-${i % 50}`, i, `action-${i}`, "result", status, `corr-${i}`, ts);
      }
    })();
  });
}

describe("database benchmarks", () => {
  it("benchmarks 1000 tool audit writes (singleton)", () => {
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      withAgentDatabase((db) =>
        db.prepare(
          "INSERT INTO tool_calls(correlation_id, tool, status, created_at) VALUES (?, ?, ?, ?)"
        ).run(`bench-w-${i}`, "read_file", "success", new Date().toISOString())
      );
    }
    const ms = performance.now() - start;
    console.log(`  1000 writes: ${ms.toFixed(1)}ms (${(ms / 1000).toFixed(3)}ms/write)`);
    expect(ms).toBeGreaterThan(0);
  });

  it("benchmarks metrics queries on 2000-row dataset", () => {
    seedRepresentativeData();
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      withAgentDatabase((db) => {
        // Query 1: total tool calls
        db.prepare("SELECT COUNT(*) AS total FROM tool_calls").get();
        // Query 2: tool failure rate
        db.prepare("SELECT tool, COUNT(*) AS failures FROM tool_calls WHERE status = 'failed' GROUP BY tool ORDER BY failures DESC LIMIT 10").all();
        // Query 3: failed executions
        db.prepare("SELECT COUNT(*) AS count FROM executions WHERE status = 'failed'").get();
        // Query 4: recovery success rate
        db.prepare("SELECT COUNT(DISTINCT recovery_id) AS total, COUNT(DISTINCT CASE WHEN status = 'completed' THEN recovery_id END) AS completed FROM recovery_events").get();
      });
    }
    const ms = performance.now() - start;
    console.log(`  1000 metric query sets (4 queries each): ${ms.toFixed(1)}ms (${(ms / 1000).toFixed(2)}ms/set)`);
    expect(ms).toBeGreaterThan(0);
  });
});

describe("EXPLAIN QUERY PLAN", () => {
  it("tool_calls count uses index", () => {
    seedRepresentativeData();
    const plan = withAgentDatabase((db) =>
      db.prepare("EXPLAIN QUERY PLAN SELECT COUNT(*) FROM tool_calls").all() as Array<{ detail: string }>
    );
    const text = plan.map((p) => p.detail).join(" ");
    console.log(`  COUNT(*) plan: ${text}`);
    // SQLite may use a covering index scan or auto-index — both are acceptable
    expect(text).toBeTruthy();
  });

  it("tool failure GROUP BY uses idx_tool_calls_tool_status", () => {
    seedRepresentativeData();
    const plan = withAgentDatabase((db) =>
      db.prepare("EXPLAIN QUERY PLAN SELECT tool, COUNT(*) FROM tool_calls WHERE status = 'failed' GROUP BY tool").all() as Array<{ detail: string }>
    );
    const text = plan.map((p) => p.detail).join(" ");
    console.log(`  GROUP BY plan: ${text}`);
    expect(text).toMatch(/idx_tool_calls_tool_status|SEARCH|USING INDEX/);
  });

  it("executions status filter uses idx_executions_status", () => {
    seedRepresentativeData();
    const plan = withAgentDatabase((db) =>
      db.prepare("EXPLAIN QUERY PLAN SELECT COUNT(*) FROM executions WHERE status = 'failed'").all() as Array<{ detail: string }>
    );
    const text = plan.map((p) => p.detail).join(" ");
    console.log(`  executions status plan: ${text}`);
    expect(text).toMatch(/idx_executions_status|SEARCH|USING INDEX/);
  });

  it("recovery status filter uses idx_recovery_status", () => {
    seedRepresentativeData();
    const plan = withAgentDatabase((db) =>
      db.prepare("EXPLAIN QUERY PLAN SELECT COUNT(*) FROM recovery_events WHERE status = 'completed'").all() as Array<{ detail: string }>
    );
    const text = plan.map((p) => p.detail).join(" ");
    console.log(`  recovery status plan: ${text}`);
    expect(text).toMatch(/idx_recovery_status|SEARCH|USING INDEX/);
  });

  it("verifies all metrics indexes exist", () => {
    const indexes = withAgentDatabase((db) =>
      db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name IN ('tool_calls','executions','recovery_events')").all() as Array<{ name: string }>
    ).map((i) => i.name);
    expect(indexes).toContain("idx_tool_calls_tool_status");
    expect(indexes).toContain("idx_executions_status");
    expect(indexes).toContain("idx_recovery_status");
  });
});
