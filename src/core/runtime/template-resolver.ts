/**
 * Template Resolver
 *
 * Resolves variable references in step arguments using outputs from completed steps.
 *
 * Syntax:
 *   {{stepN.output.field}}     — Access a field from step N's output
 *   {{stepN.output}}           — Access the entire output of step N
 *   {{stepN.status}}           — Access step N's status
 *   {{stepN.error}}            — Access step N's error message
 *
 * Examples:
 *   { "path": "{{step1.output.path}}" }
 *   { "backupId": "{{step2.output.backupId}}" }
 *   { "content": "File was: {{step1.output}}" }
 *
 * The resolver also supports nested field access:
 *   {{step1.output.result.items[0].id}}
 */

import type { TaskStep } from "../planner/task-planner.js";

// Template pattern: {{stepN.output.field}} or {{stepN.status}} or {{stepN.error}}
const TEMPLATE_PATTERN = /\{\{(step(\d+)\.(output|status|error)(?:\.([a-zA-Z0-9_]+(?:\[\d+\])*(?:\.[a-zA-Z0-9_]+(?:\[\d+\])*)*)?)?)\}\}/g;

/**
 * Build a context map from completed steps.
 * Key: "stepN" → value: { output, status, error }
 */
export function buildStepContext(completedSteps: TaskStep[]): Map<string, StepContext> {
  const context = new Map<string, StepContext>();
  for (const step of completedSteps) {
    context.set(`step${step.id}`, {
      output: step.output,
      status: step.status,
      error: step.error,
    });
  }
  return context;
}

export interface StepContext {
  output: unknown;
  status: string;
  error?: string;
}

/**
 * Resolve all template references in a value (string, object, or array).
 */
export function resolveTemplates<T>(value: T, stepContext: Map<string, StepContext>): T {
  if (typeof value === "string") {
    return resolveString(value, stepContext) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveTemplates(item, stepContext)) as T;
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = resolveTemplates(val, stepContext);
    }
    return result as T;
  }
  return value;
}

/**
 * Resolve template references in a string.
 * If the entire string is a single template, return the raw value (preserving type).
 * Otherwise, interpolate templates into the string.
 */
function resolveString(input: string, stepContext: Map<string, StepContext>): unknown {
  // Check if the entire string is a single template reference
  const singleMatch = input.match(/^{{(.+)}}$/);
  if (singleMatch) {
    const resolved = resolveReference(singleMatch[1], stepContext);
    if (resolved !== undefined) return resolved;
    // If not found, return the original string
    return input;
  }

  // Interpolate multiple templates into the string
  let hasTemplate = false;
  const result = input.replace(TEMPLATE_PATTERN, (match, refPath) => {
    hasTemplate = true;
    const resolved = resolveReference(refPath, stepContext);
    if (resolved === undefined) return match; // Keep original if not found
    return typeof resolved === "string" ? resolved : JSON.stringify(resolved);
  });

  return hasTemplate ? result : input;
}

/**
 * Resolve a reference path like "step1.output.path" against the step context.
 */
function resolveReference(refPath: string, stepContext: Map<string, StepContext>): unknown {
  const parts = refPath.split(".");
  const stepKey = parts[0]; // e.g., "step1"

  const ctx = stepContext.get(stepKey);
  if (!ctx) return undefined;

  const field = parts[1]; // "output", "status", or "error"
  if (field === "status") return ctx.status;
  if (field === "error") return ctx.error;

  // field === "output" — navigate deeper
  let current: unknown = ctx.output;
  for (let i = 2; i < parts.length; i++) {
    current = navigatePath(current, parts[i]);
    if (current === undefined) return undefined;
  }

  return current;
}

/**
 * Navigate one level deeper in a path, handling array indices.
 * e.g., "items[0]" → items[0], "result" → result
 */
function navigatePath(obj: unknown, segment: string): unknown {
  if (obj === null || obj === undefined) return undefined;

  // Handle array index: "items[0]"
  const arrayMatch = segment.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[(\d+)\]$/);
  if (arrayMatch) {
    const [, key, indexStr] = arrayMatch;
    const index = parseInt(indexStr, 10);
    const container = (obj as Record<string, unknown>)[key];
    if (!Array.isArray(container)) return undefined;
    return container[index];
  }

  // Simple property access
  return (obj as Record<string, unknown>)[segment];
}

/**
 * Check if a value contains any template references.
 */
export function hasTemplates(value: unknown): boolean {
  if (typeof value === "string") return /\{\{step\d+\.\w/.test(value);
  if (Array.isArray(value)) return value.some(hasTemplates);
  if (value !== null && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(hasTemplates);
  }
  return false;
}
