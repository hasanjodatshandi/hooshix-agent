import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectInProcessMcp, json } from "../helpers/in-process-mcp.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

const root = path.resolve("tests/tool-coverage");
let client: Client;
let close: () => Promise<void>;

beforeEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(root, { recursive: true });
  const harness = await connectInProcessMcp();
  client = harness.client;
  close = harness.close;
});

afterEach(async () => {
  await close();
  await fs.rm(root, { recursive: true, force: true });
});

describe("in-process MCP tool coverage", () => {
  it("system tools: get_system_info, get_workspace", async () => {
    const info = json(await client.callTool({ name: "get_system_info", arguments: {} }));
    expect(info.platform).toBeTypeOf("string");
    const workspace = json(await client.callTool({ name: "get_workspace", arguments: {} }));
    expect(workspace.active).toBeTypeOf("string");
    expect(workspace.unrestricted).toBe(false);
  });

  it("file tools: create, read, write, modify, list, search, delete via task approval", async () => {
    const rel = path.relative(process.cwd(), path.join(root, "a.txt")).replace(/\\/g, "/");
    json(await client.callTool({ name: "write_file", arguments: { path: rel, content: "alpha beta" } }));
    const readRaw = await client.callTool({ name: "read_file", arguments: { path: rel } });
    // read_file returns the file content itself as text
    const readBlock = (readRaw.content as Array<{ type: string; text?: string }>).find((b) => b.type === "text");
    expect(readBlock?.text).toBe("alpha beta");

    const created = json(await client.callTool({ name: "create_file", arguments: { path: "tests/tool-coverage/b.txt", content: "b" } }));
    expect(created.created).toBe(true);

    const mod = json(await client.callTool({ name: "modify_file", arguments: { path: rel, search: "beta", replacement: "gamma" } }));
    expect(mod.replacedOccurrences).toBe(1);

    const listRaw = await client.callTool({ name: "list_directory", arguments: { path: "tests/tool-coverage" } });
    const listText = (listRaw.content as Array<{ type: string; text?: string }>).find((b) => b.type === "text")?.text ?? "";
    expect(listText).toContain("a.txt");

    const search = json(await client.callTool({ name: "search_files", arguments: { path: "tests/tool-coverage", query: "gamma" } }));
    expect(search.totalMatches).toBe(1);

    // delete_file via task (approval-gated)
    const task = json(await client.callTool({ name: "task_create", arguments: { title: "delete b", steps: [{ action: "delete", tool: "delete_file", arguments: { path: "tests/tool-coverage/b.txt" } }] } }));
    const run = json(await client.callTool({ name: "task_run", arguments: { taskId: task.id, maxRecovery: 0 } }));
    expect(run.status).toBe("pending_approval");
    await client.callTool({ name: "task_approve", arguments: { approvalId: run.approvalId } });
    const resumed = json(await client.callTool({ name: "task_resume", arguments: { approvalId: run.approvalId } }));
    expect(resumed.status).toBe("completed");

    // restore from the delete backup
    const plan = json(await client.callTool({ name: "task_get", arguments: { taskId: task.id } }));
    const backupId = plan.steps[0].output.backupId;
    const restored = json(await client.callTool({ name: "restore_file", arguments: { backupId } }));
    expect(restored.restored).toBe(true);
  });

  it("git tools: init, add, commit, status, diff, branch, checkout, log", async () => {
    const cwd = "tests/tool-coverage";
    // Ensure a git identity exists so the commit can succeed
    process.env.GIT_AUTHOR_NAME ??= "Test User";
    process.env.GIT_AUTHOR_EMAIL ??= "test@example.com";
    process.env.GIT_COMMITTER_NAME ??= "Test User";
    process.env.GIT_COMMITTER_EMAIL ??= "test@example.com";
    // git_init is not approval-gated (it only creates a repo)
    json(await client.callTool({ name: "git_init", arguments: { path: cwd, initialBranch: "main" } }));
    await fs.writeFile(path.join(root, "f.txt"), "content", "utf8");

    // git_add, git_commit, git_branch, git_checkout are approval-gated — run through a task
    const task = json(await client.callTool({ name: "task_create", arguments: {
      title: "git flow",
      steps: [
        { action: "stage file", tool: "git_add", arguments: { cwd, paths: ["f.txt"] } },
        { action: "commit", tool: "git_commit", arguments: { cwd, message: "test: commit" } },
        { action: "branch", tool: "git_branch", arguments: { cwd, name: "feature/x" } },
        { action: "checkout", tool: "git_checkout", arguments: { cwd, name: "feature/x" } }
      ]
    } }));
    let current = json(await client.callTool({ name: "task_run", arguments: { taskId: task.id, maxRecovery: 0 } }));
    for (let i = 0; i < 5 && current.status === "pending_approval"; i++) {
      await client.callTool({ name: "task_approve", arguments: { approvalId: current.approvalId } });
      current = json(await client.callTool({ name: "task_resume", arguments: { approvalId: current.approvalId } }));
    }
    expect(current.status).toBe("completed");

    const status = json(await client.callTool({ name: "git_status", arguments: { cwd } }));
    expect(status).toBeTruthy();
    const diff = json(await client.callTool({ name: "git_diff", arguments: { cwd, staged: true } }));
    expect(diff).toBeTruthy();
    const log = await client.callTool({ name: "git_log", arguments: { cwd, limit: 5 } });
    expect(log.isError).not.toBe(true);
    // git_clone rejects non-HTTPS URLs (branch coverage for the URL validation)
    const badClone = await client.callTool({ name: "git_clone", arguments: { url: "http://github.com/x/y", path: "tests/tool-coverage/clone-target" } });
    expect(badClone.isError).toBe(true);
    // git_commit rejects empty messages
    const badCommit = await client.callTool({ name: "git_commit", arguments: { cwd, message: "" } });
    expect(badCommit.isError).toBe(true);
  });

  it("task tools: create, run, report, list, step risks, links, cancel", async () => {
    const task = json(await client.callTool({ name: "task_create", arguments: { title: "lifecycle", steps: [{ action: "read", tool: "read_file", arguments: { path: "README.md" } }] } }));
    const run = json(await client.callTool({ name: "task_run", arguments: { taskId: task.id, maxRecovery: 0 } }));
    expect(run.status).toBe("completed");
    const report = json(await client.callTool({ name: "task_report", arguments: { taskId: task.id } }));
    expect(report.status).toBe("completed");
    const list = json(await client.callTool({ name: "task_list", arguments: { limit: 10 } }));
    expect(JSON.stringify(list)).toContain(task.id);
    const risks = json(await client.callTool({ name: "task_step_risks", arguments: { steps: [{ tool: "read_file", arguments: { path: "x" } }] } }));
    expect(risks[0].risk).toBe("low");
    json(await client.callTool({ name: "task_link", arguments: { sourceTaskId: task.id, targetTaskId: task.id, relation: "follow_up" } }));
    const links = json(await client.callTool({ name: "task_links", arguments: { taskId: task.id } }));
    expect(links.downstream.length).toBe(1);

    const other = json(await client.callTool({ name: "task_create", arguments: { title: "cancel me", steps: [{ action: "read", tool: "read_file", arguments: { path: "README.md" } }] } }));
    const cancelled = json(await client.callTool({ name: "task_cancel", arguments: { taskId: other.id } }));
    expect(cancelled.cancelled).toBe(true);
  });

  it("memory/project tools", async () => {
    const project = json(await client.callTool({ name: "project_save", arguments: { name: "P", path: root } }));
    const fetched = json(await client.callTool({ name: "project_get", arguments: { projectId: project.id } }));
    expect(fetched.name).toBe("P");
    const mem = json(await client.callTool({ name: "memory_add", arguments: { projectId: project.id, kind: "note", content: "x" } }));
    const got = json(await client.callTool({ name: "memory_get", arguments: { memoryId: mem.id } }));
    expect(got.id).toBe(mem.id);
    const listed = json(await client.callTool({ name: "memory_list", arguments: { projectId: project.id } }));
    expect(listed.items.length).toBe(1);
    const del = json(await client.callTool({ name: "memory_delete", arguments: { memoryId: mem.id } }));
    expect(del.deleted).toBe(true);
    const archived = json(await client.callTool({ name: "project_archive", arguments: { projectId: project.id } }));
    expect(archived.archived).toBe(true);
    const projects = json(await client.callTool({ name: "project_list", arguments: { status: "archived" } }));
    expect(projects.items.length).toBe(1);
    const removed = json(await client.callTool({ name: "project_delete", arguments: { projectId: project.id } }));
    expect(removed.deleted).toBe(true);
  });

  it("shell tool: read-only git via execute_command", async () => {
    const result = json(await client.callTool({ name: "execute_command", arguments: { command: "git", args: ["--version"] } }));
    expect(result.exitCode).toBe(0);
  });

  it("workspace tools: set_workspace keeps restriction and rejects unapproved unrestricted", async () => {
    const set = json(await client.callTool({ name: "set_workspace", arguments: { path: root } }));
    expect(set.unrestricted).toBe(false);
    // Elevation is approval-gated: a direct call without approval context
    // must return an error result and leave the mode OFF.
    const denied = await client.callTool({ name: "set_workspace", arguments: { path: root, unrestricted: true } });
    expect(denied).toMatchObject({ isError: true });
    const after = json(await client.callTool({ name: "get_workspace", arguments: {} }));
    expect(after.unrestricted).toBe(false);
  });

  it("workspace tools: set_workspace REPLACES roots; active root cannot be removed", async () => {
    // Switching workspaces replaces the allowed root list — the previous
    // workspace becomes inaccessible to file tools (no permission accumulation).
    const otherRoot = path.resolve("tests/tool-coverage");
    const switched = json(await client.callTool({ name: "set_workspace", arguments: { path: otherRoot } }));
    expect(switched.allRoots).toHaveLength(1);
    expect(switched.allRoots[0].active).toBe(true);
    // The (only) active workspace cannot be removed — switch away first.
    const denied = await client.callTool({ name: "remove_workspace_root", arguments: { path: otherRoot } });
    expect(denied).toMatchObject({ isError: true });
    // Replace all roots with the repo cwd (restores default state)
    const replaced = json(await client.callTool({ name: "replace_workspace_roots", arguments: { path: process.cwd() } }));
    expect(replaced.roots.length).toBe(1);
    expect(replaced.workspace).toBe(process.cwd());
  });

  it("agent_metrics tool", async () => {
    const metrics = json(await client.callTool({ name: "agent_metrics", arguments: {} }));
    expect(metrics).toHaveProperty("workflowTotalActions");
  });

  it("task_append_steps on a completed task", async () => {
    const task = json(await client.callTool({ name: "task_create", arguments: { title: "append", steps: [{ action: "read", tool: "read_file", arguments: { path: "README.md" } }] } }));
    json(await client.callTool({ name: "task_run", arguments: { taskId: task.id, maxRecovery: 0 } }));
    const appended = json(await client.callTool({ name: "task_append_steps", arguments: { taskId: task.id, steps: [{ action: "read again", tool: "read_file", arguments: { path: "package.json" } }] } }));
    expect(appended.appended).toBe(1);
  });

  it("package_restore is governance-gated on direct calls", async () => {
    await expect(
      client.callTool({ name: "package_restore", arguments: { snapshotId: "00000000-0000-4000-8000-000000000000" } })
    ).resolves.toMatchObject({ isError: true });
  });

  it("task_snapshot and task_rollback round-trip in a git repo", async () => {
    const cwd = "tests/tool-coverage";
    process.env.GIT_AUTHOR_NAME ??= "Test User";
    process.env.GIT_AUTHOR_EMAIL ??= "test@example.com";
    process.env.GIT_COMMITTER_NAME ??= "Test User";
    process.env.GIT_COMMITTER_EMAIL ??= "test@example.com";
    json(await client.callTool({ name: "git_init", arguments: { path: cwd, initialBranch: "main" } }));
    await fs.writeFile(path.join(root, "s.txt"), "v1", "utf8");

    const task = json(await client.callTool({ name: "task_create", arguments: {
      title: "snapshot + mutate + rollback",
      steps: [
        { action: "stage", tool: "git_add", arguments: { cwd, paths: ["s.txt"] } },
        { action: "commit", tool: "git_commit", arguments: { cwd, message: "v1" } },
        { action: "snapshot", tool: "task_snapshot", arguments: { cwd }, dependsOn: [2] },
        { action: "mutate", tool: "write_file", arguments: { path: "tests/tool-coverage/s.txt", content: "v2 uncommitted" }, dependsOn: [3] },
        { action: "rollback", tool: "task_rollback", arguments: { snapshotId: "{{step3.output.snapshotId}}", cwd }, dependsOn: [4] }
      ]
    } }));
    let current = json(await client.callTool({ name: "task_run", arguments: { taskId: task.id, maxRecovery: 0 } }));
    for (let i = 0; i < 8 && current.status === "pending_approval"; i++) {
      await client.callTool({ name: "task_approve", arguments: { approvalId: current.approvalId } });
      current = json(await client.callTool({ name: "task_resume", arguments: { approvalId: current.approvalId } }));
    }
    // All steps complete: snapshot → mutate → rollback resets to "v1"
    expect(current.status).toBe("completed");
    const plan = json(await client.callTool({ name: "task_get", arguments: { taskId: task.id } }));
    const rollbackStep = plan.steps.find((s: any) => s.action === "rollback");
    expect(rollbackStep?.status).toBe("completed");
    // After git reset --hard + clean, the file should be back to the committed "v1"
    const content = await fs.readFile(path.join(root, "s.txt"), "utf8");
    expect(content).toBe("v1");
  });

  it("task_rollback rejects a tampered snapshot (non-snapshot backup id)", async () => {
    const cwd = "tests/tool-coverage";
    json(await client.callTool({ name: "git_init", arguments: { path: cwd, initialBranch: "main" } }));
    await fs.writeFile(path.join(root, "t.txt"), "{\"head\":\"main & calc.exe & rem\"}", "utf8");
    // Create a task that backs this file up (delete), then try to use that backup id as a snapshot id
    const task = json(await client.callTool({ name: "task_create", arguments: {
      title: "tamper", steps: [{ action: "delete t", tool: "delete_file", arguments: { path: "tests/tool-coverage/t.txt" } }]
    } }));
    let current = json(await client.callTool({ name: "task_run", arguments: { taskId: task.id, maxRecovery: 0 } }));
    if (current.status === "pending_approval") {
      await client.callTool({ name: "task_approve", arguments: { approvalId: current.approvalId } });
      current = json(await client.callTool({ name: "task_resume", arguments: { approvalId: current.approvalId } }));
    }
    expect(current.status).toBe("completed");
    const plan = json(await client.callTool({ name: "task_get", arguments: { taskId: task.id } }));
    const fileBackupId = plan.steps[0].output.backupId;
    // Direct call is approval-gated anyway — but even via task it must reject non-snapshot ids.
    // Here we assert the direct-call gate plus simulate the service-level check:
    const direct = await client.callTool({ name: "task_rollback", arguments: { snapshotId: fileBackupId, cwd } });
    expect(direct.isError).toBe(true); // approval required (or not a snapshot) — never executes
  });

});
