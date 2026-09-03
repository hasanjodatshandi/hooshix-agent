import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { backupAgentDatabase, cleanupAgentData, withAgentDatabase } from "../../src/core/memory/database.js";

describe("persistence hardening", () => {
  it("records ordered schema migrations and creates a consistent backup", async () => {
    const versions = withAgentDatabase((db) => db.prepare("SELECT version FROM schema_migrations ORDER BY version").all()) as Array<{ version: number }>;
    expect(versions.map((row) => row.version)).toEqual([1, 2, 3, 4, 5]);
    const destination = path.resolve("data/test-backups/agent.db.bak");
    try {
      expect(await backupAgentDatabase(destination)).toBe(destination);
      const stat = await fs.stat(destination);
      expect(stat.size).toBeGreaterThan(0);
    } finally {
      await fs.rm(path.dirname(destination), { recursive: true, force: true });
    }
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
