import { describe, expect, it } from "vitest";
import { withAgentDatabase } from "../../src/core/memory/database.js";
import { restoreInterruptedTasks } from "../../src/core/recovery/startup-recovery.js";

describe("startup recovery", () => {
  it("loads interrupted task sessions", () => {
    withAgentDatabase((db) => {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT OR REPLACE INTO tasks(id, description, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run("startup-recovery-test", "resume agent", "executing", now, now);
    });

    const sessions = restoreInterruptedTasks();

    expect(
      sessions.some((session: any) => session.task.id === "startup-recovery-test")
    ).toBe(true);
  });
});
