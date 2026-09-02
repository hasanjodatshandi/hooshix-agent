import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import { recordStepExecution, reflectOnStep } from "../../src/core/reflection/reflection-engine.js";

describe("reflection engine", () => {
  it("records execution result in memory", async () => {
    await recordStepExecution(
      { id: 1, action: "inspect", status: "completed" },
      { ok: true }
    );

    const memory = JSON.parse(await fs.readFile(process.env.HOOSHIX_MEMORY_FILE!, "utf8"));

    expect(memory.executions.length).toBeGreaterThan(0);
  });

  it("returns recovery decision on failure", () => {
    expect(reflectOnStep(false)).toBe("recover");
    expect(reflectOnStep(true)).toBe("continue");
  });
});
