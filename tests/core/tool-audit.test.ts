import { describe, expect, it } from "vitest";
import { auditToolCall } from "../../src/core/memory/tool-audit.js";
import { withAgentDatabase } from "../../src/core/memory/database.js";

describe("MCP tool audit", () => {
  it("records successful and failed calls without arguments or results", async () => {
    await expect(auditToolCall("read_file", "tool-audit", "task-1", () => "ok")).resolves.toBe("ok");
    await expect(auditToolCall("read_file", "tool-audit", "task-1", () => {
      throw new Error("failure");
    })).rejects.toThrow("failure");

    const rows = withAgentDatabase((db) => db.prepare("SELECT tool, status, task_id FROM tool_calls WHERE correlation_id = ? ORDER BY id").all("tool-audit"));
    expect(rows).toEqual([
      { tool: "read_file", status: "success", task_id: "task-1" },
      { tool: "read_file", status: "failed", task_id: "task-1" }
    ]);
  });

  it("classifies orchestration, governance, observability, and workflow calls explicitly", async () => {
    const corr = `tool-audit-categories-${Date.now()}`;
    await auditToolCall("task_reconcile", corr, "task-1", () => "ok");
    await auditToolCall("task_approve", corr, "task-1", () => "ok");
    await auditToolCall("task_report", corr, "task-1", () => "ok");
    await auditToolCall("read_file", corr, "task-1", () => "ok");

    const rows = withAgentDatabase((db) => db.prepare(
      "SELECT tool, category FROM tool_calls WHERE correlation_id = ? ORDER BY id"
    ).all(corr));
    expect(rows).toEqual([
      { tool: "task_reconcile", category: "orchestration" },
      { tool: "task_approve", category: "orchestration" },
      { tool: "task_report", category: "observability" },
      { tool: "read_file", category: "workflow" },
    ]);
  });
});
