/**
 * Metrics-aware McpServer wrapper
 *
 * Wraps McpServer to intercept tool calls and record metrics.
 * Non-invasive: tools register normally, metrics are collected transparently.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpMetrics } from "./metrics.js";

/**
 * Creates an McpServer that wraps tool handlers with metrics collection.
 */
export function createMetricsServer(
  options: { name: string; version: string },
  registerTools: (server: McpServer) => void,
): McpServer {
  const server = new McpServer(options);

  // Store original registerTool to intercept
  const originalRegisterTool = server.registerTool.bind(server);

  // Override registerTool to wrap handlers with metrics
  (server as any).registerTool = function (
    name: string,
    config: any,
    handler: (...args: any[]) => Promise<any>,
  ) {
    const wrappedHandler = async (...args: any[]) => {
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

    return originalRegisterTool(name, config, wrappedHandler);
  };

  // Register tools using the intercepted registerTool
  registerTools(server);

  return server;
}
