import { describe, expect, it } from "vitest";
import { saveTaskMemory, saveDecisionMemory } from "../../src/core/memory/sqlite-memory.js";
import Database from "better-sqlite3";

describe("sqlite task memory", () => {
  it("stores task and decision history", () => {
    saveTaskMemory({
      id: "task-1",
      description: "build agent",
      status: "executing"
    });

    saveDecisionMemory({
      taskId: "task-1",
      reason: "verification failed",
      action: "create recovery step"
    });

    const db = new Database(process.env.HOOSHIX_DB_PATH!);
    const tasks = db.prepare("SELECT * FROM tasks WHERE id = ?").get("task-1") as { description: string };
    const decisions = db.prepare("SELECT * FROM decisions WHERE task_id = ?").all("task-1");
    db.close();

    expect(tasks.description).toBe("build agent");
    expect(decisions.length).toBeGreaterThan(0);
  });
});
