import { describe, expect, it } from "vitest";
import { saveExecutionMemory, getExecutionMemory } from "../../src/core/memory/sqlite-memory.js";

describe("sqlite agent memory", () => {
  it("persists execution history", () => {
    saveExecutionMemory({
      stepId: 1,
      action: "inspect project",
      result: { ok: true }
    });

    const rows = getExecutionMemory();

    expect(rows.length).toBeGreaterThan(0);
    expect((rows[0] as { action: string }).action).toBe("inspect project");
  });
});
