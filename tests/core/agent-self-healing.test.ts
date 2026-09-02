import { describe, expect, it } from "vitest";
import { AgentSelfHealingService } from "../../src/core/trace/agent-self-healing-service.js";

describe("agent self healing", () => {
  it("creates recovery decision from failure trace", () => {
    const service = new AgentSelfHealingService({
      getTrace: () => [
        {
          type: "execution",
          timestamp: "now",
          data: { step_id: 2, result: { error: "build failed" } }
        }
      ]
    } as any);

    const result = service.analyze("corr");

    expect(result.finding.failedStep).toBe(2);
    expect(result.recovery.type).toBe("stop");
  });
});
