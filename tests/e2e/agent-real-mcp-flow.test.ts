import path from "node:path";
import { describe, expect, it } from "vitest";
import { createAgentMcpRuntime } from "../../src/core/runtime/agent-mcp-runtime.js";
import { createTaskPlan } from "../../src/core/planner/task-planner.js";
import { findExecutionsByCorrelationId } from "../../src/core/memory/correlation-memory.js";
import { getExecutionTrace } from "../../src/core/memory/execution-trace.js";

describe("agent to real MCP process", () => {
  it("executes a typed tool call and persists the shared correlation id", async () => {
    const runtime = await createAgentMcpRuntime(process.execPath, [
      path.resolve("node_modules/tsx/dist/cli.mjs"),
      path.resolve("src/index.ts")
    ]);
    try {
      const plan = createTaskPlan("read package metadata", [{
        action: "read package.json",
        tool: "read_file",
        arguments: { path: "package.json" }
      }]);
      const result = await runtime.run(plan);
      expect(result.status).toBe("completed");
      const rows = findExecutionsByCorrelationId(runtime.context.correlationId) as Array<{ task_id: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0].task_id).toBe(plan.id);
      expect(new Set(getExecutionTrace(runtime.context.correlationId).map((event) => event.type))).toEqual(
        new Set(["task", "execution", "checkpoint", "tool_call"])
      );
    } finally {
      await runtime.close();
    }
  }, 30000);
});
