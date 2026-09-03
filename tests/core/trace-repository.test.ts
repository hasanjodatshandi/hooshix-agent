import { describe, expect, it } from "vitest";
import { ExecutionTraceService } from "../../src/core/trace/execution-trace-service.js";

describe("trace repository abstraction", () => {
  it("loads trace through repository", () => {
    const service = new ExecutionTraceService({
      findByCorrelationId: () => [{ id: "execution:1", correlationId: "corr", source: "runtime", type: "execution", timestamp: "now", payload: {} }]
    });

    expect(service.getTrace("corr").length).toBe(1);
  });
});
