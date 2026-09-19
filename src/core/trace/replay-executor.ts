import type { TaskRuntimeService } from "../runtime/task-runtime-service.js";
import { TOOL_CAPABILITIES, selectTool } from "../orchestrator/tool-orchestrator.js";

export type ReplayMode = "readonly" | "sandbox" | "live";

export interface ReplayComparison {
  comparedAt: string;
  equivalentFinalStepStatuses: boolean;
  equivalentOutputs: boolean;
  equivalentLifecycle: boolean;
  sideEffects: "not_verified" | "verified";
  /** Step ids whose outputs could not be proven equivalent because the
   *  original template arguments were not persisted (legacy rows) — the
   *  replay reused the source run's resolved values for them. */
  staleValueStepIds: number[];
}

export interface ExecutionReplayResult {
  sourceTaskId: string;
  replayTaskId: string;
  status: string;
  mode: ReplayMode;
  comparison: ReplayComparison;
  result: unknown;
}

export interface ReplayBlockedResult {
  status: "blocked";
  reason: "mutation_confirmation_required";
  mutatingSteps: number[];
  requiresAllowMutations: true;
}

/** Volatile fields that are execution metadata, not semantic output. */
const VOLATILE_FIELDS = new Set([
  "backupId", "correlationId", "taskId", "stepId",
  "attemptId", "revisionId", "executionId", "sessionId",
  "startedAt", "completedAt", "createdAt", "updatedAt",
  "durationMs", "retryCount"
]);

/**
 * Normalize a tool output for semantic comparison (TR-05).
 * Strips volatile execution metadata so deterministic tool outputs
 * compare equal across original and replay runs.
 */
function normalizeReplayOutput(tool: string | undefined, output: unknown): unknown {
  if (output === null || output === undefined || typeof output !== "object") {
    return output;
  }
  if (Array.isArray(output)) {
    return output.map((item) => normalizeReplayOutput(tool, item));
  }
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(output)) {
    if (VOLATILE_FIELDS.has(key)) {
      // Keep a sentinel so structure is preserved but value is ignored
      normalized[key] = "__volatile__";
    } else if (typeof value === "object" && value !== null) {
      normalized[key] = normalizeReplayOutput(tool, value);
    } else {
      normalized[key] = value;
    }
  }
  return normalized;
}

export class ReplayExecutor {
  constructor(private readonly runtime: TaskRuntimeService) {}

  async replay(taskId: string, allowMutations = false, mode: ReplayMode = allowMutations ? "live" : "readonly"): Promise<ExecutionReplayResult | ReplayBlockedResult> {
    const source = this.runtime.get(taskId);
    if (!source) throw new Error("Task not found");
    const mutating = source.steps.filter((step) => TOOL_CAPABILITIES[selectTool(step)].risk !== "low");
    if (mutating.length > 0 && !allowMutations) {
      return {
        status: "blocked",
        reason: "mutation_confirmation_required",
        mutatingSteps: mutating.map((step) => step.id),
        requiresAllowMutations: true,
      };
    }

    const replay = this.runtime.create({
      title: `Replay: ${source.task}`,
      description: `Execution replay of ${source.id} (mode=${mode})`,
      steps: source.steps.map((step) => ({
        action: step.action,
        tool: step.tool,
        // Prefer the immutable declared templates. Steps WITHOUT templates
        // replay from their plain declared arguments (equivalent by
        // construction). Steps WITH templates that lost their
        // templateArguments (legacy rows) would replay the SOURCE's resolved
        // values — Stage 19 proved that silently reuses the source run's
        // dynamic outputs, so equivalence for those steps is unprovable.
        arguments: structuredClone(step.templateArguments ?? step.arguments ?? {}),
        dependsOn: [...(step.dependsOn ?? [])]
      }))
    });
    const result = await this.runtime.run(replay.id, 0);
    // A step that consumes another step's output but has no persisted
    // templateArguments replays with stale resolved values. The replay
    // reused the source run's resolved values for them.
    const staleProne = new Set(
      source.steps
        .filter((step) => !step.templateArguments && (step.dependsOn ?? []).length > 0)
        .map((step) => step.id)
    );
    return {
      sourceTaskId: source.id,
      replayTaskId: replay.id,
      status: result.status,
      mode,
      comparison: {
        comparedAt: new Date().toISOString(),
        equivalentFinalStepStatuses: source.steps.every((step, index) => step.status === result.plan.steps[index]?.status),
        equivalentOutputs: source.steps.every((step, index) => {
          const replayStep = result.plan.steps[index];
          if (!replayStep) return false;
          if (staleProne.has(step.id)) return false; // stale-prone — equivalence unprovable
          // Normalize outputs to strip volatile execution metadata (TR-05)
          const normalizedOriginal = normalizeReplayOutput(step.tool, step.output);
          const normalizedReplay = normalizeReplayOutput(replayStep.tool, replayStep.output);
          return JSON.stringify(normalizedOriginal) === JSON.stringify(normalizedReplay);
        }),
        equivalentLifecycle: source.steps.every((step, index) => {
          const replayStep = result.plan.steps[index];
          if (!replayStep) return false;
          return step.status === replayStep.status;
        }),
        sideEffects: "not_verified",
        staleValueStepIds: [...staleProne],
      },
      result
    };
  }
}
