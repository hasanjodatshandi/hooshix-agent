import type { ExecutionTraceEvent } from "../memory/execution-trace.js";

export interface DebugFinding {
  failedStep?: number;
  reason: string;
  source: string;
}

function parseObject(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  if (typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

export function analyzeTraceFailure(events: ExecutionTraceEvent[]): DebugFinding {
  let failed: ExecutionTraceEvent | undefined;
  let failedData: Record<string, unknown> | undefined;
  let failedResult: Record<string, unknown> | undefined;

  for (let index = events.length - 1; index >= 0; index--) {
    const data = parseObject(events[index].payload ?? events[index].data);
    const result = parseObject(data?.result);
    const state = parseObject(data?.state);
    if (data?.status === "failed" || result?.error || state?.status === "failed") {
      failed = events[index];
      failedData = data;
      failedResult = result;
      break;
    }
  }

  if (!failed) {
    return {
      reason: "No failure event found in trace",
      source: "trace"
    };
  }

  return {
    failedStep: typeof failedData?.step_id === "number" ? failedData.step_id : undefined,
    reason: String(failedResult?.error ?? failedData?.status ?? "failed"),
    source: failed.type
  };
}
