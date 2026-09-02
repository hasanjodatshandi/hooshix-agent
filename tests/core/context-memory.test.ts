import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { saveExecutionWithContext } from "../../src/core/memory/context-memory.js";

describe("context memory propagation", () => {
  it("stores correlation id with execution", () => {
    saveExecutionWithContext({
      stepId: 1,
      action: "test",
      result: { ok:true },
      context: { correlationId:"corr-test", createdAt:new Date().toISOString() }
    });

    const db = new Database(process.env.HOOSHIX_DB_PATH!);
    const row:any = db.prepare("SELECT * FROM executions ORDER BY id DESC LIMIT 1").get();
    db.close();

    expect(row.correlation_id).toBe("corr-test");
  });
});
