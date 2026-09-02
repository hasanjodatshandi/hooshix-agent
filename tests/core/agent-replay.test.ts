import { describe, expect, it } from "vitest";
import { AgentReplayService } from "../../src/core/trace/agent-replay-service.js";

describe("agent replay", () => {
  it("builds replay report from trace", () => {
    const service = new AgentReplayService({
      getTrace: () => [
        { type: "execution", timestamp: "now", data: { step: 1 } }
      ]
    } as any);

    const report = service.replayExecution("corr-1");

    expect(report.correlationId).toBe("corr-1");
    expect(report.totalEvents).toBe(1);
  });
});
