import { describe, expect, it } from "vitest";
import { openAgentDatabase } from "../../src/core/memory/database.js";
import { getResumableTasks, getResumePoint } from "../../src/core/memory/resume-memory.js";

describe("resume memory", () => {
  it("finds unfinished tasks", () => {
    const db = openAgentDatabase();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT OR REPLACE INTO tasks(id, description, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run("resume-test", "continue work", "executing", now, now);

    db.close();

    const tasks = getResumableTasks();

    expect(tasks.some((task: any) => task.id === "resume-test")).toBe(true);
  });

  it("returns null when no resume point exists", () => {
    expect(getResumePoint("unknown-task")).toBe(null);
  });
});
