import { describe, expect, it } from "vitest";
import { createStdioMcpInvoker } from "../../src/core/mcp/stdio-client-bridge.js";

describe("mcp stdio bridge", () => {
  it("exports MCP client bridge factory", () => {
    expect(typeof createStdioMcpInvoker).toBe("function");
  });
});
