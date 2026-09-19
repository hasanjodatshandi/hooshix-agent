import { validateToolArguments, validateToolName } from "./legacy-tool-orchestrator.js";
import type { TaskPlan, TemplateValidationError } from "../dto/legacy-task-plan.js";

function extractTemplateRefs(value: unknown, path = ""): Array<{ refPath: string; fullToken: string; argPath: string }> {
  const results: Array<{ refPath: string; fullToken: string; argPath: string }> = [];
  if (typeof value === "string") {
    const helperRegex = /\{\{(string|number|boolean|json)\((step\d+(?:\.[a-zA-Z0-9_[\]]+)*)\)\}\}/g;
    const directRegex = /\{\{(step\d+(?:\.(?:output|status|error)(?:\.[a-zA-Z0-9_[\]]+)*)?)\}\}/g;
    let match: RegExpExecArray | null;
    while ((match = helperRegex.exec(value)) !== null) results.push({ refPath: match[2], fullToken: match[0], argPath: path });
    while ((match = directRegex.exec(value)) !== null) results.push({ refPath: match[1], fullToken: match[0], argPath: path });
    return results;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) results.push(...extractTemplateRefs(value[i], `${path}[${i}]`));
    return results;
  }
  if (value !== null && typeof value === "object") {
    for (const [key,val] of Object.entries(value as Record<string,unknown>)) {
      results.push(...extractTemplateRefs(val, path ? `${path}.${key}` : key));
    }
  }
  return results;
}

export function validateTemplateReferences(plan: TaskPlan): TemplateValidationError[] {
  const errors: TemplateValidationError[] = [];
  const stepIds = new Set(plan.steps.map(s=>s.id));
  const stepOrder = new Map<number,number>();
  plan.steps.forEach((s,i)=>stepOrder.set(s.id,i));
  for (const step of plan.steps) {
    for (const ref of extractTemplateRefs(step.arguments ?? {})) {
      const refStepId=parseInt(ref.refPath.replace("step",""),10);
      if (!stepIds.has(refStepId)) errors.push({stepId:step.id,argumentPath:ref.argPath,template:ref.fullToken,reason:"unknown_step_reference"});
      else if (refStepId===step.id) errors.push({stepId:step.id,argumentPath:ref.argPath,template:ref.fullToken,reason:"self_reference"});
      else if ((stepOrder.get(refStepId) ?? -1) > (stepOrder.get(step.id) ?? -1)) errors.push({stepId:step.id,argumentPath:ref.argPath,template:ref.fullToken,reason:"future_step_reference"});
    }
  }
  return errors;
}

export function validateTaskPlan(plan: TaskPlan): TaskPlan {
  if (!plan.task.trim()) throw new Error("Task title must not be empty");
  if (plan.steps.length === 0) throw new Error("Task must contain at least one step");
  const seen=new Set<number>();
  for (const [index,step] of plan.steps.entries()) {
    if (seen.has(step.id)) throw new Error(`Duplicate step id: ${step.id}`);
    step.dependsOn ??= index>0 ? [plan.steps[index-1].id] : [];
    for (const dependency of step.dependsOn) {
      if (dependency===step.id) throw new Error(`Step ${step.id} cannot depend on itself`);
      if (!seen.has(dependency)) throw new Error(`Step ${step.id} depends on missing or later step ${dependency}`);
    }
    if (step.tool) {
      step.tool=validateToolName(step.tool);
      step.arguments=validateToolArguments(step.tool,step.arguments ?? {});
    }
    step.status ??="pending";
    seen.add(step.id);
  }
  const templateErrors=validateTemplateReferences(plan);
  if (templateErrors.length) {
    const summary=templateErrors.map(e=>`${e.reason}: ${e.template} in step ${e.stepId} (${e.argumentPath})`).join("; ");
    throw new Error(`Invalid template references: ${summary}`);
  }
  return plan;
}
