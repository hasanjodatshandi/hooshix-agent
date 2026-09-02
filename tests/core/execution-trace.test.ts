import { describe, expect, it } from "vitest";
import { getExecutionTrace } from "../../src/core/memory/execution-trace.js";
import { saveExecutionMemory } from "../../src/core/memory/sqlite-memory.js";

describe("execution trace", () => {
  it("loads events by correlation id", () => {
    saveExecutionMemory({
      stepId: 1,
      action: "trace test",
      result: { ok: true },
      correlationId: "trace-query-test"
    });

    const trace = getExecutionTrace("trace-query-test");

    expect(trace.some((event) => event.type === "execution")).toBe(true);
  });
});
