import { describe, expect, it } from "vitest";
import { saveExecutionMemory, findExecutionsByCorrelationId } from "../../src/core/memory/correlation-memory.js";

describe("correlation execution tracing", () => {
  it("retrieves executions by correlation id", () => {
    saveExecutionMemory({
      stepId: 1,
      action: "read_file",
      result: { ok: true },
      correlationId: "trace-test-1"
    });

    const rows = findExecutionsByCorrelationId("trace-test-1");

    expect(rows.length).toBeGreaterThan(0);
    expect((rows[0] as { correlation_id: string }).correlation_id).toBe("trace-test-1");
  });
});
