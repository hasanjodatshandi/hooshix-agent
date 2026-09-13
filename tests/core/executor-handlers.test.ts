import { describe, expect, it } from "vitest";
import { dispatchToHandler } from "../../src/core/executor/handlers/index.js";
import { SystemToolHandler } from "../../src/core/executor/handlers/system-handler.js";
import { FileToolHandler } from "../../src/core/executor/handlers/file-handler.js";
import { GitToolHandler } from "../../src/core/executor/handlers/git-handler.js";
import { PackageToolHandler } from "../../src/core/executor/handlers/package-handler.js";
import { ShellToolHandler } from "../../src/core/executor/handlers/shell-handler.js";
import { TaskSnapshotToolHandler } from "../../src/core/executor/handlers/task-snapshot-handler.js";

describe("executor handlers: canHandle coverage", () => {
  it("system handler handles its own tools and rejects others", async () => {
    const handler = new SystemToolHandler();
    expect(handler.canHandle("get_system_info")).toBe(true);
    expect(handler.canHandle("agent_metrics")).toBe(true);
    expect(handler.canHandle("get_workspace")).toBe(true);
    expect(handler.canHandle("set_workspace")).toBe(true);
    expect(handler.canHandle("read_file")).toBe(false);
    const info = await handler.handle({ tool: "get_system_info", input: {}, correlationId: "c1" });
    expect((info as { platform: string }).platform).toBeTypeOf("string");
    const metrics = await handler.handle({ tool: "agent_metrics", input: { limit: 5, offset: 0 }, correlationId: "c1" });
    expect(metrics).toHaveProperty("workflowTotalActions");
    const withTask = await handler.handle({ tool: "agent_metrics", input: { taskId: "550e8400-e29b-41d4-a716-446655440000" }, correlationId: "c1" });
    expect(withTask).toHaveProperty("pagination");
    // Non-UUID taskId is rejected by the canonical schema (same as the direct tool)
    await expect(handler.handle({ tool: "agent_metrics", input: { taskId: "x" }, correlationId: "c1" })).rejects.toThrow();
    await expect(handler.handle({ tool: "get_system_info", input: {}, correlationId: "c" } as never)).resolves.toBeTruthy();
    await expect(handler.handle({ tool: "read_file" as never, input: {}, correlationId: "c" })).rejects.toThrow(/unsupported tool/);
  });

  it("file handler rejects unsupported and missing fields", async () => {
    const handler = new FileToolHandler();
    expect(handler.canHandle("read_file")).toBe(true);
    expect(handler.canHandle("git_status")).toBe(false);
    // missing path
    await expect(handler.handle({ tool: "read_file", input: {}, correlationId: "c" })).rejects.toThrow();
    // list default path
    await expect(handler.handle({ tool: "list_directory", input: {}, correlationId: "c" })).resolves.toBeTruthy();
    // search without query
    await expect(handler.handle({ tool: "search_files", input: { path: "." }, correlationId: "c" })).rejects.toThrow();
    await expect(handler.handle({ tool: "restore_file", input: { backupId: "not-a-uuid" }, correlationId: "c" })).rejects.toThrow();
  });

  it("git/package/shell/snapshot handlers declare their tools", () => {
    expect(new GitToolHandler().canHandle("git_status")).toBe(true);
    expect(new GitToolHandler().canHandle("git_add")).toBe(true);
    expect(new GitToolHandler().canHandle("git_log")).toBe(true);
    expect(new GitToolHandler().canHandle("read_file")).toBe(false);
    expect(new PackageToolHandler().canHandle("install_package")).toBe(true);
    expect(new PackageToolHandler().canHandle("package_restore")).toBe(true);
    expect(new PackageToolHandler().canHandle("read_file")).toBe(false);
    expect(new ShellToolHandler().canHandle("execute_command")).toBe(true);
    expect(new ShellToolHandler().canHandle("read_file")).toBe(false);
    expect(new TaskSnapshotToolHandler().canHandle("task_snapshot")).toBe(true);
    expect(new TaskSnapshotToolHandler().canHandle("task_rollback")).toBe(true);
    expect(new TaskSnapshotToolHandler().canHandle("read_file")).toBe(false);
  });

  it("dispatchToHandler throws for tools with no handler", () => {
    expect(() => dispatchToHandler("unknown_tool" as never, {}, "c")).toThrow(/No handler/);
  });
});
