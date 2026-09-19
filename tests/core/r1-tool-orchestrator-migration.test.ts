import { describe, expect, it } from "vitest";
import * as legacy from "../../src/core/orchestrator/tool-orchestrator.js";
import * as current from "../../src/application/services/legacy-tool-orchestrator.js";

describe("R1 legacy tool-orchestrator migration", () => {
  it("keeps old exports as exact aliases of the application-owned policy", () => {
    expect(legacy.TOOL_NAMES).toBe(current.TOOL_NAMES);
    expect(legacy.TOOL_CAPABILITIES).toBe(current.TOOL_CAPABILITIES);
    expect(legacy.ALL_REGISTERED_TOOLS).toBe(current.ALL_REGISTERED_TOOLS);
    expect(legacy.validateToolName).toBe(current.validateToolName);
    expect(legacy.validateToolArguments).toBe(current.validateToolArguments);
    expect(legacy.ToolSelector).toBe(current.ToolSelector);
    expect(legacy.selectTool).toBe(current.selectTool);
    expect(legacy.executeToolStep).toBe(current.executeToolStep);
  });

  it("preserves heuristic selection semantics without claiming the R2 canonical catalog", () => {
    expect(current.selectTool({ action: "inspect git status" })).toBe("git_status");
    expect(current.selectTool({ action: "find TODO markers" })).toBe("search_files");
    expect(current.selectTool({ action: "unknown wording" })).toBe("search_files");
  });

  it("preserves required-argument validation", () => {
    expect(() => current.validateToolArguments("read_file", {})).toThrow(/missing path/);
    expect(current.validateToolArguments("read_file", { path: "x" })).toEqual({ path: "x" });
  });
});
