/** R3.02 receipt construction for Task-side effects. No arguments or effect output
 * enter receipts; only allowlisted hashes and observed references are stored. */
import { createHash, randomUUID } from "node:crypto";
import type { TaskStep } from "../../application/dto/legacy-task-plan.js";
import { OPERATION_CATALOG, type ToolName } from "../../application/services/operation-catalog.js";
import type { ExecutionReceipt } from "../../domain/task/execution-outcome.js";
import type { ExecutionId, StepId, ToolId } from "../../domain/shared/ids.js";

const SHA256=/^[a-fA-F0-9]{64}$/;

function revision(value:unknown):string|undefined {
  return typeof value==="string"&&SHA256.test(value)?value.toLowerCase():undefined;
}

export function createMutationReceipt(step:TaskStep,tool:ToolName):ExecutionReceipt|undefined {
  const descriptor=OPERATION_CATALOG[tool];
  if(descriptor.effect==="read_only")return undefined;
  const executionId=randomUUID() as ExecutionId;
  const args=step.arguments??{};
  const key=descriptor.supportsIdempotency?args.idempotencyKey:undefined;
  const idempotencyKeyHash=typeof key==="string"&&key.length>0
    ?createHash("sha256").update(key,"utf8").digest("hex"):undefined;
  return {
    executionId,stepId:step.id as StepId,toolId:tool as ToolId,effect:descriptor.effect,
    effectId:executionId,startedAt:new Date().toISOString(),status:"started",
    reconciliation:"unresolved",
    ...(idempotencyKeyHash?{idempotencyKeyHash}:{}),
    ...(revision(args.expectedSha256??args.expectedRevision)
      ?{preconditionRevision:revision(args.expectedSha256??args.expectedRevision)}:{}),
  };
}

export function finalizeMutationReceipt(
  started:ExecutionReceipt,status:"succeeded"|"failed_known"|"outcome_unknown",
  result?:unknown,
):ExecutionReceipt {
  if(started.status!=="started")throw new Error("receipt_already_final");
  const resultObject=result&&typeof result==="object"&&!Array.isArray(result)
    ?result as Record<string,unknown>:undefined;
  const postconditionRevision=status==="succeeded"
    ?revision(resultObject?.sha256??resultObject?.postRevision):undefined;
  return {
    ...started,status,
    finishedAt:new Date().toISOString(),
    termination:status==="outcome_unknown"?"unknown":"completed",
    reconciliation:status==="outcome_unknown"?"unresolved":"not_required",
    ...(postconditionRevision?{postconditionRevision}:{}),
  };
}
