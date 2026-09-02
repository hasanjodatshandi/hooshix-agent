import { describe, expect, it } from "vitest";
import { ExecutionTraceService } from "../../src/core/trace/execution-trace-service.js";

describe("trace repository abstraction", () => {
  it("loads trace through repository", () => {
    const service = new ExecutionTraceService({
      findByCorrelationId: () => [{ type: "execution", timestamp: "now", data: {} }]
    });

    expect(service.getTrace("corr").length).toBe(1);
  });
});
