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
      status: "pending",
      arguments: { path: "README.md" }
    });

    expect(called).toBe("read_file");
  });

  it("rejects unknown tool names before invoking transport", async () => {
    let invoked = false;
    const executor = createMcpToolExecutor({ async callTool() { invoked = true; return {}; } });
    await expect(executor("nonexistent_tool", { id: 1, action: "bad", status: "pending" })).rejects.toThrow("Unknown tool");
    expect(invoked).toBe(false);
  });

  it("validates required arguments before invoking transport", async () => {
    let invoked = false;
    const executor = createMcpToolExecutor({ async callTool() { invoked = true; return {}; } });
    await expect(executor("read_file", { id: 1, action: "read", status: "pending", arguments: {} })).rejects.toThrow("missing path");
    expect(invoked).toBe(false);
  });

  it("validates argument types before invoking transport", async () => {
    let invoked = false;
    const executor = createMcpToolExecutor({ async callTool() { invoked = true; return {}; } });
    await expect(executor("read_file", { id: 1, action: "read", status: "pending", arguments: 42 as any })).rejects.toThrow("Invalid arguments");
    expect(invoked).toBe(false);
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
