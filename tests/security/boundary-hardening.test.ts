import { afterEach, describe, expect, it } from "vitest";
import { createMcpToolExecutor } from "../../src/core/orchestrator/mcp-tool-executor.js";
import { createTaskPlan } from "../../src/core/planner/task-planner.js";
import { executeShellCommand } from "../../src/services/shell/shell-service.js";
import { readWorkspaceFile } from "../../src/services/filesystem/filesystem-service.js";

const original = process.env.HOOSHIX_PERMISSION_LEVEL;
afterEach(() => {
  if (original === undefined) delete process.env.HOOSHIX_PERMISSION_LEVEL;
  else process.env.HOOSHIX_PERMISSION_LEVEL = original;
});

describe("security boundaries", () => {
  it("rejects command injection controls and keeps shell metacharacters literal", async () => {
    await expect(executeShellCommand("node", ["tests/fixtures/echo-args.cjs", "bad\ncommand"])).rejects.toThrow("control characters");
    expect((await executeShellCommand("node", ["tests/fixtures/echo-args.cjs", "$(whoami); & calc"])).stdout).toBe("$(whoami); & calc");
  });

  it("blocks traversal and permission bypass at the service boundary", async () => {
    await expect(readWorkspaceFile("../secret.txt")).rejects.toThrow("outside workspace");
    process.env.HOOSHIX_PERMISSION_LEVEL = "READ_ONLY";
    expect(() => createTaskPlan("write", [{ action: "write", tool: "write_file", arguments: { path: "x", content: "x" } }])).not.toThrow();
    await expect(executeShellCommand("node", ["--version"])).rejects.toThrow("DEVELOPER_MODE");
  });

  it("rejects an invalid MCP tool before invoking the transport", async () => {
    let invoked = false;
    const executor = createMcpToolExecutor({ async callTool() { invoked = true; return {}; } });
    await expect(executor("unknown_tool", { id: 1, action: "bad", status: "pending" })).rejects.toThrow("Unknown tool");
    expect(invoked).toBe(false);
  });
});
