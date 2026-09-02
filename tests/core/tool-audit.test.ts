import { describe, expect, it } from "vitest";
import { auditToolCall } from "../../src/core/memory/tool-audit.js";
import { openAgentDatabase } from "../../src/core/memory/database.js";

describe("MCP tool audit", () => {
  it("records successful and failed calls without arguments or results", async () => {
    await expect(auditToolCall("read_file", "tool-audit", "task-1", () => "ok")).resolves.toBe("ok");
    await expect(auditToolCall("read_file", "tool-audit", "task-1", () => {
      throw new Error("failure");
    })).rejects.toThrow("failure");

    const db = openAgentDatabase();
    const rows = db.prepare("SELECT tool, status, task_id FROM tool_calls WHERE correlation_id = ? ORDER BY id").all("tool-audit");
    db.close();
    expect(rows).toEqual([
      { tool: "read_file", status: "success", task_id: "task-1" },
      { tool: "read_file", status: "failed", task_id: "task-1" }
    ]);
  });
});
