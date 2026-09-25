/**
 * Metrics-aware McpServer wrapper
 *
 * Wraps McpServer to intercept tool calls and record metrics.
 * Non-invasive: tools register normally, metrics are collected transparently.
 */

import { McpServer } from "../adapters/inbound/mcp/legacy-sdk-bridge.js";
import { mcpMetrics } from "./metrics.js";
import { captureToolRegistrar, installToolRegistrar, type ToolRegistrar } from "./tool-registrar.js";

/**
 * Creates an McpServer that wraps tool handlers with metrics collection.
 */
export function createMetricsServer(
  options: { name: string; version: string },
  registerTools: (server: McpServer) => void,
): McpServer {
  const server = new McpServer(options);

  // Capture the real registrar before replacing it, then install a wrapper
  // that times every handler and records success/failure.
  const registerTool = captureToolRegistrar(server);

  const withMetrics: ToolRegistrar = (name, config, ...rest) => {
    const handler = rest[0] as ((...args: any[]) => Promise<any>) | undefined;
    if (typeof handler !== "function") return registerTool(name, config, ...rest);
    const wrappedHandler = async (...args: [any, ...any[]]) => {
      const startTime = performance.now();
      let success = true;
      let error: string | undefined;

      try {
        const result = await handler(...args);
        return result;
      } catch (err) {
        success = false;
        error = err instanceof Error ? err.message : String(err);
        throw err;
      } finally {
        const durationMs = performance.now() - startTime;
        // Extract sessionId from extra if available
        const extra = args[1] as any;
        const sessionId = extra?.sessionId ?? "unknown";
        mcpMetrics.recordToolCall(name, durationMs, success, sessionId, error);
        mcpMetrics.logToolCall(name, durationMs, success, sessionId);
      }
    };

    return registerTool(name, config, wrappedHandler, ...rest.slice(1));
  };

  installToolRegistrar(server, withMetrics);

  // Register tools using the intercepted registerTool
  registerTools(server);

  return server;
}