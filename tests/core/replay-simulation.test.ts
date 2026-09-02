import { describe, expect, it } from "vitest";
import { AgentReplaySimulationService } from "../../src/core/trace/replay-simulation-service.js";

describe("replay simulation", () => {
  it("simulates execution without running tools", () => {
    const service = new AgentReplaySimulationService({
      replayExecution: () => ({
        correlationId: "sim-1",
        totalEvents: 1,
        steps: [{ type: "execution", timestamp: "now", data: {} }]
      })
    } as any);

    const result = service.simulate("sim-1");

    expect(result.mode).toBe("simulation");
    expect(result.steps[0].simulated).toBe(true);
  });
});
