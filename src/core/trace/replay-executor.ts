import type { TaskRuntimeService } from "../runtime/task-runtime-service.js";
import { TOOL_CAPABILITIES, selectTool } from "../orchestrator/tool-orchestrator.js";

export interface ExecutionReplayResult {
  sourceTaskId: string;
  replayTaskId: string;
  status: string;
  equivalentStepStates: boolean;
  result: unknown;
}

export class ReplayExecutor {
  constructor(private readonly runtime: TaskRuntimeService) {}

  async replay(taskId: string, allowMutations = false): Promise<ExecutionReplayResult> {
    const source = this.runtime.get(taskId);
    if (!source) throw new Error("Task not found");
    const mutating = source.steps.filter((step) => TOOL_CAPABILITIES[selectTool(step)].risk !== "low");
    if (mutating.length > 0 && !allowMutations) {
      throw new Error(`Execution replay contains mutating steps (${mutating.map((step) => step.id).join(", ")}); explicit confirmation is required`);
    }

    const replay = this.runtime.create({
      title: `Replay: ${source.task}`,
      description: `Execution replay of ${source.id}`,
      steps: source.steps.map((step) => ({
        action: step.action,
        tool: step.tool,
        arguments: structuredClone(step.arguments ?? {}),
        dependsOn: [...(step.dependsOn ?? [])]
      }))
    });
    const result = await this.runtime.run(replay.id, 0);
    return {
      sourceTaskId: source.id,
      replayTaskId: replay.id,
      status: result.status,
      equivalentStepStates: source.steps.every((step, index) => step.status === result.plan.steps[index]?.status),
      result
    };
  }
}
