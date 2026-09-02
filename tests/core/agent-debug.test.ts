import { describe, expect, it } from "vitest";
import { AgentDebugService } from "../../src/core/trace/agent-debug-service.js";

describe("agent debug", () => {
  it("finds failed step from trace", () => {
    const service = new AgentDebugService({
      getTrace: () => [
        {
          type: "execution",
          timestamp: "now",
          data: { step_id: 3, result: { error: "failed" } }
        }
      ]
    } as any);

    const result = service.diagnose("corr");

    expect(result.failedStep).toBe(3);
  });
});
