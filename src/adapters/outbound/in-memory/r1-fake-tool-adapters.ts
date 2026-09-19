import type { ToolDescriptor } from "../../../domain/tool/tool-descriptor.js";
import type { ToolId } from "../../../domain/shared/ids.js";
import type { ToolDescriptorPort, ToolHandlerPort } from "../../../application/use-cases/tools/execute-tool.usecase.js";
import type { ToolInputValidatorPort } from "../../../application/ports/outbound/operations.port.js";
import type { AuditPort } from "../../../application/ports/outbound/support.port.js";
export function createFakeReadOnlyToolAdapters(descriptor: ToolDescriptor, value: unknown) {
 const calls: { toolId: ToolId; args: unknown }[] = [];
 const catalog: ToolDescriptorPort = { get(id) { return id===descriptor.id ? descriptor : null; } };
 const validator: ToolInputValidatorPort = { validate(_id,input) {
   return input !== null && typeof input==="object" && !Array.isArray(input)
     ? { valid: true, value: input } : { valid: false, reason: "invalid_arguments" };
 } };
 const handler: ToolHandlerPort = { async execute(toolId,args) { calls.push({toolId,args}); return value; } };
 const audit: AuditPort = { async record() { /* No real I/O in test adapter. */ } };
 return { catalog, validator, handler, audit, calls };
}
