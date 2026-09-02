import type { ReplayReport } from "./replay-engine.js";

export interface SimulationStep {
  step: number;
  type: string;
  simulated: boolean;
}

export interface ReplaySimulationResult {
  correlationId: string;
  mode: "simulation";
  steps: SimulationStep[];
}

export function simulateReplay(report: ReplayReport): ReplaySimulationResult {
  return {
    correlationId: report.correlationId,
    mode: "simulation",
    steps: report.steps.map((step, index) => ({
      step: index + 1,
      type: step.type,
      simulated: true
    }))
  };
}
