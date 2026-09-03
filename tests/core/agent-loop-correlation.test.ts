import { describe, expect, it } from "vitest";
import { withAgentDatabase } from "../../src/core/memory/database.js";
import { runClosedAgentLoop } from "../../src/core/loop/closed-agent-loop.js";
import { createExecutionContext } from "../../src/core/runtime/execution-context.js";

describe("agent loop correlation propagation", () => {
  it("stores execution with shared correlation id", async () => {
    const context = createExecutionContext({ taskId: "trace-task", correlationId: "trace-corr" });

    await runClosedAgentLoop({
      id: "trace-task",
      task: "trace",
      steps: [{ id: 1, action: "normal action", status: "pending" }]
    } as any, async () => ({ ok: true }), 1, 0, context);

    const row = withAgentDatabase((db) => db.prepare("SELECT * FROM executions ORDER BY id DESC LIMIT 1").get()) as any;
    expect(row.correlation_id).toBe("trace-corr");
  });
});
