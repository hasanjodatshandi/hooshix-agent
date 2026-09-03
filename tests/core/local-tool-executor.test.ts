import fs from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { execa } from "execa";
import { createLocalToolExecutor } from "../../src/core/executor/local-tool-executor.js";

const root = "tests/runtime-local-executor";
const execute = createLocalToolExecutor("local-executor-trace", "local-executor-task");
const step = (tool: any, arguments_: Record<string, unknown>) => ({ id: 1, action: tool, tool, arguments: arguments_, status: "pending" as const });

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("local typed tool executor", () => {
  it("dispatches all filesystem and system operations", async () => {
    expect(await execute("get_system_info", step("get_system_info", {}))).toHaveProperty("platform");
    await execute("create_file", step("create_file", { path: `${root}/created.txt`, content: "needle one" }));
    await execute("write_file", step("write_file", { path: `${root}/written.txt`, content: "before" }));
    expect(await execute("read_file", step("read_file", { path: `${root}/created.txt` }))).toBe("needle one");
    await execute("modify_file", step("modify_file", { path: `${root}/written.txt`, search: "before", replacement: "needle two" }));
    expect(JSON.stringify(await execute("list_directory", step("list_directory", { path: root })))).toContain("created.txt");
    expect(JSON.stringify(await execute("search_files", step("search_files", { path: root, query: "needle" })))).toContain("written.txt");

    const deleted = await execute("delete_file", step("delete_file", { path: `${root}/created.txt` })) as { backupId: string };
    await execute("restore_file", step("restore_file", { backupId: deleted.backupId }));
    expect(await fs.readFile(`${root}/created.txt`, "utf8")).toBe("needle one");
  });

  it("dispatches Git operations and rejects unsupported tools", async () => {
    await fs.mkdir(root, { recursive: true });
    await execa("git", ["init"], { cwd: root });
    await execa("git", ["config", "user.email", "executor@example.invalid"], { cwd: root });
    await execa("git", ["config", "user.name", "Executor Test"], { cwd: root });
    await fs.writeFile(`${root}/file.txt`, "one\n", "utf8");
    await execa("git", ["add", "file.txt"], { cwd: root });

    await execute("git_commit", step("git_commit", { cwd: root, message: "initial" }));
    await fs.writeFile(`${root}/file.txt`, "two\n", "utf8");
    expect(JSON.stringify(await execute("git_status", step("git_status", { cwd: root })))).toContain("file.txt");
    expect(JSON.stringify(await execute("git_diff", step("git_diff", { cwd: root, staged: false })))).toContain("+two");
    await execute("git_branch", step("git_branch", { cwd: root, name: "executor-branch" }));
    await execute("git_checkout", step("git_checkout", { cwd: root, name: "executor-branch" }));

    await expect(execute("git_clone", step("git_clone", { url: "file:///unsafe", path: `${root}/clone` }))).rejects.toThrow("credential-free HTTPS");
    await expect(execute("unknown", step("unknown", {}))).rejects.toThrow("Unknown tool");
  });

  it("audits schema errors with the task correlation id", async () => {
    await expect(execute("read_file", step("read_file", {}))).rejects.toThrow();
  });
});
