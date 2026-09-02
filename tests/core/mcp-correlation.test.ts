import { describe, expect, it } from "vitest";
import { createMcpToolExecutor } from "../../src/core/orchestrator/mcp-tool-executor.js";

describe("mcp correlation id", () => {
  it("adds correlation id to tool requests", async () => {
    let args: any;

    const executor = createMcpToolExecutor({
      async callTool(_name, input) {
        args = input;
        return {};
      }
    });

    await executor("read_file", {
      id: 1,
      action: "inspect",
      status: "pending"
    });

    expect(typeof args.correlationId).toBe("string");
  });
});
