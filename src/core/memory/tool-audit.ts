import { insertToolCallAuditRow } from "../../adapters/outbound/persistence/sqlite/repositories/tool-call-audit.adapter.js";
import {bestEffortTelemetry} from "../trace/telemetry-degradation.js";

/** Classify tool calls into categories for metric separation. */
const OBSERVABILITY_TOOLS = new Set([
  "agent_metrics", "task_report", "task_get", "task_list", "task_links", "task_step_risks"
]);
const ORCHESTRATION_TOOLS = new Set([
  "task_create", "task_run", "task_resume", "task_approve", "task_cancel", "task_replay",
  "task_append_steps", "task_link", "task_reconcile"
]);

type CallCategory = "workflow" | "observability" | "orchestration" | "governance";

function classifyCall(tool: string): CallCategory {
  if (OBSERVABILITY_TOOLS.has(tool)) return "observability";
  if (ORCHESTRATION_TOOLS.has(tool)) return "orchestration";
  return "workflow";
}

function record(tool: string, correlationId: string, taskId: string | undefined, status: "success" | "failed", startedAt: string, durationMs: number, error?: unknown): void {
  insertToolCallAuditRow({
    tool, correlationId, taskId, status, category: classifyCall(tool), startedAt, durationMs,
    errorName: error instanceof Error ? error.name : error === undefined ? null : "UnknownError"
  });
}

export async function auditToolCall<T>(
  tool:string,correlationId:string,taskId:string|undefined,
  operation:()=>Promise<T>|T,
):Promise<T>{
  const startedAt=new Date().toISOString(),started=performance.now();
  let outcome:T;
  try{outcome=await operation();}
  catch(error){
    // Audit failure must not replace the ORIGINAL business failure.
    bestEffortTelemetry(()=>record(tool,correlationId,taskId,"failed",startedAt,
      Math.max(0,Math.round(performance.now()-started)),error));
    throw error;
  }
  // This is outside the operation try/catch: if audit persistence fails after
  // a successful external side effect, do not reinterpret it as tool failure.
  bestEffortTelemetry(()=>record(tool,correlationId,taskId,"success",startedAt,
    Math.max(0,Math.round(performance.now()-started))));
  return outcome;
}
