import { describe, expect, it, afterEach } from "vitest";
import {
  openAgentDatabase,
  closeAgentDatabase,
  resetAgentDatabase,
  withAgentDatabase,
} from "../../src/core/memory/database.js";

afterEach(() => {
  resetAgentDatabase();
});

describe("database lifecycle", () => {
  it("initializes on first openAgentDatabase call", () => {
    const db = openAgentDatabase();
    expect(db).toBeDefined();
    // Verify tables exist
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain("tasks");
    expect(tableNames).toContain("tool_calls");
    expect(tableNames).toContain("recovery_events");
    expect(tableNames).toContain("executions");
  });

  it("returns the same connection on repeated calls (shared singleton)", () => {
    const db1 = openAgentDatabase();
    const db2 = openAgentDatabase();
    expect(db1).toBe(db2);
  });

  it("withAgentDatabase uses the same shared connection", () => {
    const db1 = openAgentDatabase();
    withAgentDatabase((db2) => {
      expect(db1).toBe(db2);
    });
  });

  it("closeAgentDatabase releases the connection", () => {
    openAgentDatabase();
    closeAgentDatabase();
    // After close, next open should create a fresh connection
    const db = openAgentDatabase();
    expect(db).toBeDefined();
    // Verify it works
    const result = db.prepare("SELECT 1 AS ok").get() as { ok: number };
    expect(result.ok).toBe(1);
  });

  it("resetAgentDatabase closes and allows fresh reconnection", () => {
    const db1 = openAgentDatabase();
    resetAgentDatabase();
    const db2 = openAgentDatabase();
    expect(db1).not.toBe(db2);
  });

  it("no connection leak: open → write → close → reopen does not error", () => {
    withAgentDatabase((db) => {
      db.prepare(
        "INSERT INTO tool_calls(correlation_id, tool, status, created_at) VALUES (?, ?, ?, ?)"
      ).run("leak-test", "read_file", "success", new Date().toISOString());
    });
    closeAgentDatabase();
    // Reopen — should not throw or leave stale state
    const count = withAgentDatabase(
      (db) =>
        (db.prepare("SELECT COUNT(*) AS c FROM tool_calls").get() as { c: number })
          .c
    );
    expect(count).toBe(1);
  });

  it("WAL mode is enabled", () => {
    const mode = withAgentDatabase(
      (db) => (db.pragma("journal_mode", { simple: true }) as string)
    );
    expect(mode).toBe("wal");
  });

  it("foreign keys are enabled", () => {
    const fk = withAgentDatabase(
      (db) => (db.pragma("foreign_keys", { simple: true }) as number)
    );
    expect(fk).toBe(1);
  });

  it("busy timeout is set to 5000ms", () => {
    const timeout = withAgentDatabase(
      (db) => (db.pragma("busy_timeout", { simple: true }) as number)
    );
    expect(timeout).toBe(5000);
  });
});
