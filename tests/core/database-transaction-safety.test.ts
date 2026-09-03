import { describe, expect, it, afterEach } from "vitest";
import { withAgentDatabase, resetAgentDatabase } from "../../src/core/memory/database.js";

afterEach(() => {
  resetAgentDatabase();
});

function insertToolCall(tool: string, status: string): number {
  return Number(withAgentDatabase((db) =>
    db.prepare(
      "INSERT INTO tool_calls(correlation_id, tool, status, created_at) VALUES (?, ?, ?, ?)"
    ).run(`test-${Date.now()}`, tool, status, new Date().toISOString()).lastInsertRowid
  ));
}

function countToolCalls(): number {
  return withAgentDatabase(
    (db) => (db.prepare("SELECT COUNT(*) AS c FROM tool_calls").get() as { c: number }).c
  );
}

describe("transaction rollback safety", () => {
  it("db.transaction() auto-rollbacks on throw — no rows persisted", () => {
    const before = countToolCalls();

    expect(() => {
      withAgentDatabase((db) => {
        db.transaction(() => {
          db.prepare(
            "INSERT INTO tool_calls(correlation_id, tool, status, created_at) VALUES (?, ?, ?, ?)"
          ).run("should-rollback", "read_file", "success", new Date().toISOString());
          throw new Error("intentional failure");
        })();
      });
    }).toThrow("intentional failure");

    const after = countToolCalls();
    expect(after).toBe(before);
  });

  it("connection remains usable after a rolled-back transaction", () => {
    // Rollback a transaction
    expect(() => {
      withAgentDatabase((db) => {
        db.transaction(() => {
          db.prepare(
            "INSERT INTO tool_calls(correlation_id, tool, status, created_at) VALUES (?, ?, ?, ?)"
          ).run("rollback-1", "read_file", "success", new Date().toISOString());
          throw new Error("fail");
        })();
      });
    }).toThrow("fail");

    // Connection should still work
    const id = insertToolCall("write_file", "success");
    expect(id).toBeGreaterThan(0);
    expect(countToolCalls()).toBe(1);
  });

  it("multiple successful transactions after a rollback", () => {
    // Rollback
    expect(() => {
      withAgentDatabase((db) => {
        db.transaction(() => {
          db.prepare(
            "INSERT INTO tool_calls(correlation_id, tool, status, created_at) VALUES (?, ?, ?, ?)"
          ).run("rb-1", "read_file", "success", new Date().toISOString());
          throw new Error("fail");
        })();
      });
    }).toThrow("fail");

    // Three successful transactions
    insertToolCall("a", "success");
    insertToolCall("b", "failed");
    insertToolCall("c", "success");

    expect(countToolCalls()).toBe(3);
  });

  it("partial transaction data not visible to subsequent reads", () => {
    withAgentDatabase((db) => {
      // Start a transaction, insert, but don't commit (manual control)
      db.exec("BEGIN");
      db.prepare(
        "INSERT INTO tool_calls(correlation_id, tool, status, created_at) VALUES (?, ?, ?, ?)"
      ).run("manual-tx", "read_file", "success", new Date().toISOString());

      // Read inside the same connection — row IS visible (same transaction)
      const insideTx = db.prepare(
        "SELECT COUNT(*) AS c FROM tool_calls WHERE correlation_id = ?"
      ).get("manual-tx") as { c: number };
      expect(insideTx.c).toBe(1);

      // Rollback
      db.exec("ROLLBACK");
    });

    // After rollback, data should not exist
    const afterRollback = withAgentDatabase((db) =>
      (db.prepare("SELECT COUNT(*) AS c FROM tool_calls WHERE correlation_id = ?").get("manual-tx") as { c: number }).c
    );
    expect(afterRollback).toBe(0);
  });

  it("withAgentDatabase transaction wrapper commits on success", () => {
    withAgentDatabase((db) => {
      db.transaction(() => {
        db.prepare(
          "INSERT INTO tool_calls(correlation_id, tool, status, created_at) VALUES (?, ?, ?, ?)"
        ).run("committed", "read_file", "success", new Date().toISOString());
      })();
    });

    const count = withAgentDatabase((db) =>
      (db.prepare("SELECT COUNT(*) AS c FROM tool_calls WHERE correlation_id = ?").get("committed") as { c: number }).c
    );
    expect(count).toBe(1);
  });
});
