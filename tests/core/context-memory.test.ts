import { describe, expect, it } from "vitest";
import { withAgentDatabase } from "../../src/core/memory/database.js";
import { saveExecutionWithContext } from "../../src/core/memory/context-memory.js";

describe("context memory propagation", () => {
  it("stores correlation id with execution", () => {
    saveExecutionWithContext({
      stepId: 1,
      action: "test",
      result: { ok:true },
      context: { correlationId:"corr-test", createdAt:new Date().toISOString() }
    });

    const row = withAgentDatabase((db) => db.prepare("SELECT * FROM executions ORDER BY id DESC LIMIT 1").get()) as any;
    expect(row.correlation_id).toBe("corr-test");
  });
});
