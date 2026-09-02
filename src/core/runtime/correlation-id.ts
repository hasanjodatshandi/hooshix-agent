import { randomUUID } from "node:crypto";

export function createCorrelationId() {
  return randomUUID();
}

export function resolveCorrelationId(value?: string): string {
  return value?.trim() || createCorrelationId();
}
