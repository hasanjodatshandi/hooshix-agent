import type { ToolId } from "../../../domain/shared/ids.js";
export interface ToolInputValidatorPort {
  validate(toolId: ToolId, input: unknown): { readonly valid: true; readonly value: unknown } | { readonly valid: false; readonly reason: string };
}
