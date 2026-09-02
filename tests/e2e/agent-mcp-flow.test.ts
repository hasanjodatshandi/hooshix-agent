import { describe, expect, it } from "vitest";
import { createTaskPlan } from "../../src/core/planner/task-planner.js";
import { runClosedAgentLoop } from "../../src/core/loop/closed-agent-loop.js";
import { createMcpToolExecutor } from "../../src/core/orchestrator/mcp-tool-executor.js";

describe("agent mcp end to end flow", () => {
  it("executes a task through MCP tool executor boundary", async () => {
    const calls: string[] = [];

    const executor = createMcpToolExecutor({
      async callTool(name) {
        calls.push(name);
        return { content: [{ text: "ok" }] };
      }
    });

    const result = await runClosedAgentLoop(
      createTaskPlan("inspect project"),
      executor
    );

    expect(result.status).toBe("completed");
    expect(calls.length).toBe(3);
  });
});
