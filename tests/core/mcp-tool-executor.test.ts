import { describe, expect, it } from "vitest";
import { createMcpToolExecutor } from "../../src/core/orchestrator/mcp-tool-executor.js";

describe("mcp tool executor", () => {
  it("binds orchestrator calls to MCP invoker", async () => {
    let called = "";

    const executor = createMcpToolExecutor({
      async callTool(name) {
        called = name;
        return { ok: true };
      }
    });

    await executor("read_file", {
      id: 1,
      action: "inspect project",
      status: "pending"
    });

    expect(called).toBe("read_file");
  });

  it("turns MCP error results into execution failures", async () => {
    const executor = createMcpToolExecutor({
      async callTool() {
        return { isError: true, content: [{ type: "text", text: "invalid path" }] };
      }
    });
    await expect(executor("read_file", {
      id: 1,
      action: "read",
      status: "pending",
      arguments: { path: "missing.txt" }
    })).rejects.toThrow("invalid path");
  });
});
