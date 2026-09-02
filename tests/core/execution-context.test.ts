import { describe, expect, it } from "vitest";
import { createExecutionContext } from "../../src/core/runtime/execution-context.js";

describe("execution context", () => {
  it("creates trace context", () => {
    const context = createExecutionContext({ taskId: "task-1" });

    expect(context.correlationId).toBeTruthy();
    expect(context.taskId).toBe("task-1");
  });
});
