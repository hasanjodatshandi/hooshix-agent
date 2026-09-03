import { describe, expect, it, afterEach } from "vitest";
import { withAgentDatabase, resetAgentDatabase } from "../../src/core/memory/database.js";

afterEach(() => {
  resetAgentDatabase();
});

function insertToolCall(correlationId: string, tool: string, status: string): void {
  withAgentDatabase((db) =>
    db.prepare(
      "INSERT INTO tool_calls(correlation_id, tool, status, created_at) VALUES (?, ?, ?, ?)"
    ).run(correlationId, tool, status, new Date().toISOString())
  );
}

function insertExecution(taskId: string, stepId: number, action: string, status: string): void {
  withAgentDatabase((db) =>
    db.prepare(
      "INSERT INTO executions(task_id, step_id, action, status, correlation_id, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(taskId, stepId, action, status, `exec-${taskId}`, new Date().toISOString())
  );
}

function countTable(table: string): number {
  return withAgentDatabase(
    (db) => (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c
  );
}

describe("transaction failure recovery", () => {
  it("failed transaction A does not prevent successful transaction B", () => {
    // Operation A: fails
    expect(() => {
      withAgentDatabase((db) => {
        db.transaction(() => {
          db.prepare(
            "INSERT INTO tool_calls(correlation_id, tool, status, created_at) VALUES (?, ?, ?, ?)"
          ).run("op-a", "read_file", "success", new Date().toISOString());
          throw new Error("operation A failed");
        })();
      });
    }).toThrow("operation A failed");

    // Operation B: should succeed
    insertToolCall("op-b", "write_file", "success");
    expect(countTable("tool_calls")).toBe(1);
  });

  it("no SQLITE_BUSY after failed transaction", () => {
    // Fail a transaction
    expect(() => {
      withAgentDatabase((db) => {
        db.transaction(() => {
          db.prepare(
            "INSERT INTO tool_calls(correlation_id, tool, status, created_at) VALUES (?, ?, ?, ?)"
          ).run("busy-test", "read_file", "success", new Date().toISOString());
          throw new Error("fail");
        })();
      });
    }).toThrow("fail");

    // Multiple rapid operations should not throw SQLITE_BUSY
    for (let i = 0; i < 50; i++) {
      expect(() => {
        insertToolCall(`rapid-${i}`, "read_file", "success");
      }).not.toThrow();
    }
    expect(countTable("tool_calls")).toBe(50);
  });

  it("manual BEGIN without ROLLBACK leaves open transaction — resetAgentDatabase recovers", () => {
    // Simulate abandoned transaction via manual BEGIN + throw (skipping ROLLBACK)
    expect(() => {
      withAgentDatabase((db) => {
        db.exec("BEGIN");
        db.prepare(
          "INSERT INTO tool_calls(correlation_id, tool, status, created_at) VALUES (?, ?, ?, ?)"
        ).run("abandoned", "read_file", "success", new Date().toISOString());
        throw new Error("abandon");
      });
    }).toThrow("abandon");

    // The connection now has an open transaction. A new BEGIN would fail.
    // resetAgentDatabase() closes and reopens — the best-sqlite3 auto-rollback on close.
    resetAgentDatabase();

    // After reset, connection works and the abandoned insert is gone.
    insertToolCall("after-reset", "read_file", "success");
    expect(countTable("tool_calls")).toBe(1);
  });

  it("concurrent transaction attempts on same connection serialize safely", () => {
    // better-sqlite3 is synchronous — sequential calls interleave at JS level
    // but the database serializes them via WAL. Verify no corruption.
    const results: number[] = [];
    for (let i = 0; i < 100; i++) {
      withAgentDatabase((db) => {
        db.transaction(() => {
          db.prepare(
            "INSERT INTO tool_calls(correlation_id, tool, status, created_at) VALUES (?, ?, ?, ?)"
          ).run(`serial-${i}`, "read_file", "success", new Date().toISOString());
          const count = (db.prepare("SELECT COUNT(*) AS c FROM tool_calls").get() as { c: number }).c;
          results.push(count);
        })();
      });
    }

    expect(countTable("tool_calls")).toBe(100);
    // Each count should be monotonically increasing (no lost writes)
    for (let i = 1; i < results.length; i++) {
      expect(results[i]).toBeGreaterThan(results[i - 1]);
    }
  });
});

describe("concurrent writes", () => {
  it("50 tool audit writes via Promise.all interleaving", async () => {
    const promises = Array.from({ length: 50 }, (_, i) =>
      Promise.resolve().then(() => {
        insertToolCall(`conc-tool-${i}`, i % 3 === 0 ? "write_file" : "read_file", i % 7 === 0 ? "failed" : "success");
      })
    );

    await Promise.all(promises);
    expect(countTable("tool_calls")).toBe(50);
  });

  it("50 execution writes interleaved with tool writes", async () => {
    const promises = Array.from({ length: 100 }, (_, i) =>
      Promise.resolve().then(() => {
        if (i % 2 === 0) {
          insertToolCall(`mixed-${i}`, "read_file", "success");
        } else {
          insertExecution(`task-${i}`, i, `action-${i}`, "completed");
        }
      })
    );

    await Promise.all(promises);
    expect(countTable("tool_calls")).toBe(50);
    expect(countTable("executions")).toBe(50);
  });

  it("100 rapid sequential writes — no corruption, correct count", () => {
    for (let i = 0; i < 100; i++) {
      insertToolCall(`rapid-${i}`, "read_file", i % 10 === 0 ? "failed" : "success");
    }

    expect(countTable("tool_calls")).toBe(100);

    // Verify data integrity: all tools are readable and correct
    const rows = withAgentDatabase((db) =>
      db.prepare("SELECT correlation_id, tool, status FROM tool_calls ORDER BY id").all()
    ) as Array<{ correlation_id: string; tool: string; status: string }>;

    expect(rows.length).toBe(100);
    for (let i = 0; i < 100; i++) {
      expect(rows[i].correlation_id).toBe(`rapid-${i}`);
      expect(rows[i].tool).toBe("read_file");
      expect(rows[i].status).toBe(i % 10 === 0 ? "failed" : "success");
    }
  });

  it("mixed operations: insert, read, update, delete — no lock issues", () => {
    // Insert
    for (let i = 0; i < 30; i++) {
      insertToolCall(`mixed-op-${i}`, "read_file", "success");
    }
    expect(countTable("tool_calls")).toBe(30);

    // Read + Update
    withAgentDatabase((db) => {
      const rows = db.prepare("SELECT id FROM tool_calls WHERE status = 'success'").all() as Array<{ id: number }>;
      expect(rows.length).toBe(30);
      const update = db.prepare("UPDATE tool_calls SET status = 'updated' WHERE id = ?");
      for (const row of rows) {
        update.run(row.id);
      }
    });

    // Verify update
    const updatedCount = withAgentDatabase((db) =>
      (db.prepare("SELECT COUNT(*) AS c FROM tool_calls WHERE status = 'updated'").get() as { c: number }).c
    );
    expect(updatedCount).toBe(30);

    // Delete half
    withAgentDatabase((db) => {
      db.prepare("DELETE FROM tool_calls WHERE id % 2 = 0").run();
    });

    const remaining = countTable("tool_calls");
    expect(remaining).toBe(15);
  });

  it("no SQLITE_BUSY under rapid sequential load", () => {
    const start = performance.now();
    for (let i = 0; i < 200; i++) {
      expect(() => {
        insertToolCall(`load-${i}`, "read_file", "success");
      }).not.toThrow();
    }
    const elapsed = performance.now() - start;
    expect(countTable("tool_calls")).toBe(200);
    // Should complete well within busy_timeout (5000ms)
    expect(elapsed).toBeLessThan(5000);
  });
});
