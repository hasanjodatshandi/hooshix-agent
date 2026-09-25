/**
 * The SDK exposes `registerTool` as two generic overloads (StandardSchema and
 * ZodRawShape). Binding the method to its instance collapses them into one
 * callable shape, so the title-mirroring and gateway-mediation wrappers below
 * can re-assign a single well-typed slot instead of reaching for `any`.
 *
 * This file is the ONLY place that casts the registrar; both inbound server
 * wrappers go through it.
 */
import { type RegisteredTool } from "@modelcontextprotocol/server";
import type { McpServer } from "../adapters/inbound/mcp/legacy-sdk-bridge.js";

/** Single-arity view of the overloaded `McpServer.registerTool` method. */
export type ToolRegistrar = (name: string, config: any, ...rest: any[]) => RegisteredTool;

/**
 * Take the current registrar off a server instance. The result still carries
 * `this`, so it can be called directly.
 */
export function captureToolRegistrar(server: McpServer): ToolRegistrar {
  return server.registerTool.bind(server) as unknown as ToolRegistrar;
}

/**
 * Install a replacement registrar. `server.registerTool` is declared as a pair
 * of generic overloads, so the assignment itself needs a narrowing to the
 * single-arity shape — never to `any`, which would disable checking on every
 * tool registration afterwards.
 */
export function installToolRegistrar(server: McpServer, replacement: ToolRegistrar): void {
  (server as McpServer & { registerTool: ToolRegistrar }).registerTool = replacement;
}
