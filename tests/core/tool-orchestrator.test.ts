import { describe, expect, it } from "vitest";
import { executeToolStep, selectTool } from "../../src/core/orchestrator/tool-orchestrator.js";

describe("tool orchestrator", () => {
  it("selects tool from step intent", () => {
    expect(selectTool({ id: 1, action: "inspect project", status: "pending" })).toBe("read_file");
    expect(selectTool({ id: 2, action: "implement changes", status: "pending" })).toBe("write_file");
  });

  it("executes selected tool", async () => {
    const result = await executeToolStep(
      { id: 1, action: "verify result", status: "pending" },
      async (tool) => tool
    );

    expect(result.tool).toBe("execute_command");
  });
});
