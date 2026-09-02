import type { AgentReplayService } from "./agent-replay-service.js";
import { simulateReplay, type ReplaySimulationResult } from "./replay-simulator.js";

export class AgentReplaySimulationService {
  constructor(private readonly replayService: AgentReplayService) {}

  simulate(correlationId: string): ReplaySimulationResult {
    const report = this.replayService.replayExecution(correlationId);
    return simulateReplay(report);
  }
}
