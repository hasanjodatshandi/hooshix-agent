import { describe, expect, it } from "vitest";
import { createAgentMcpRuntime } from "../../src/core/runtime/agent-mcp-runtime.js";

describe("agent mcp runtime", () => {
  it("exports runtime factory", () => {
    expect(typeof createAgentMcpRuntime).toBe("function");
  });
});
