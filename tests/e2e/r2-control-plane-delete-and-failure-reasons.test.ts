import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { connectInProcessMcp, json } from "../helpers/in-process-mcp.js";
import { createDisposableFixture } from "../helpers/r0-disposable-fixtures.js";
import { addWorkspaceRoots, removeWorkspaceRoot, setActiveWorkspace } from "../../src/security/workspace-guard.js";

/**
 * The 2026-10-02 end-to-end audit found project_delete / memory_delete in a
 * governance deadlock: the catalog demanded `approval: "always"`, which can
 * only be satisfied by an approved Task step, yet those control-plane tools
 * cannot be Task steps at all. They are now `on-risk` like every other
 * control-plane mutation, so a direct call must execute.
 */
describe("R2 control-plane delete tools are directly executable", () => {
  it("project_delete and memory_delete no longer require an impossible approval", async () => {
    const fixture = createDisposableFixture("deadlock-probe");
    addWorkspaceRoots([fixture.root]);
    setActiveWorkspace(fixture.root);
    const mcp = await connectInProcessMcp();
    try {
      const project = json(await mcp.client.callTool({
        name: "project_save",
        arguments: { name: "deadlock-probe-" + Date.now(), path: fixture.root },
      })) as { id: string };
      expect(project.id).toBeTruthy();

      const deleted = await mcp.client.callTool({ name: "project_delete", arguments: { projectId: project.id } });
      expect(deleted.isError).not.toBe(true);
      expect(json(deleted)).toMatchObject({ projectId: project.id, deleted: true });

      const memory = json(await mcp.client.callTool({
        name: "memory_add",
        arguments: { kind: "note", content: "deadlock probe memory" },
      })) as { id: number };
      expect(memory.id).toBeTruthy();

      const memDeleted = await mcp.client.callTool({ name: "memory_delete", arguments: { memoryId: memory.id } });
      expect(memDeleted.isError).not.toBe(true);
      expect(json(memDeleted)).toMatchObject({ memoryId: memory.id, deleted: true });
    } finally {
      await mcp.close();
      setActiveWorkspace(process.cwd());
      try { removeWorkspaceRoot(fixture.root); } catch { /* pool reinitialized per test */ }
      fixture.cleanup();
    }
  });
});

/**
 * Semantic failures must surface a stable recoverable reason instead of the
 * opaque tool_handler_failure, so a caller can react instead of blind-retry.
 */
describe("R2 gateway surfaces typed failure reasons", () => {
  it("STALE_WRITE precondition reports stale_write, not tool_handler_failure", async () => {
    const fixture = createDisposableFixture("stale-write-reason");
    addWorkspaceRoots([fixture.root]);
    setActiveWorkspace(fixture.root);
    const target = path.join(fixture.root, "stale.txt");
    fs.writeFileSync(target, "alpha");
    const mcp = await connectInProcessMcp();
    try {
      const stale = await mcp.client.callTool({
        name: "write_file",
        arguments: { path: target, content: "beta", ifMatchSha256: "0".repeat(64) },
      });
      expect(stale.isError).toBe(true);
      const block = (stale as { content: Array<{ type: string; text?: string }> }).content.find((b) => b.type === "text");
      expect(block?.text).toBe("stale_write");
      expect(fs.readFileSync(target, "utf8")).toBe("alpha");
    } finally {
      await mcp.close();
      setActiveWorkspace(process.cwd());
      try { removeWorkspaceRoot(fixture.root); } catch { /* pool reinitialized per test */ }
      fixture.cleanup();
    }
  });

  it("empty memory content reports memory_content_required", async () => {
    const mcp = await connectInProcessMcp();
    try {
      const result = await mcp.client.callTool({
        name: "memory_add",
        arguments: { kind: "note", content: "   " },
      });
      expect(result.isError).toBe(true);
      const block = (result as { content: Array<{ type: string; text?: string }> }).content.find((b) => b.type === "text");
      expect(block?.text).toBe("memory_content_required");
    } finally {
      await mcp.close();
    }
  });

  it("appending to a terminal Task reports task_append_rejected", async () => {
    const mcp = await connectInProcessMcp();
    try {
      const created = await mcp.client.callTool({
        name: "task_create",
        arguments: {
          title: "terminal append reason probe",
          steps: [{ action: "read", tool: "read_file", arguments: { path: "README.md" } }],
        },
      });
      const taskId = (json(created) as { id: string }).id;
      const finished = await mcp.client.callTool({ name: "task_run", arguments: { taskId, maxRecovery: 0 } });
      expect((json(finished) as { status: string }).status).toBe("completed");

      const appended = await mcp.client.callTool({
        name: "task_append_steps",
        arguments: { taskId, steps: [{ action: "late", tool: "read_file", arguments: { path: "README.md" } }] },
      });
      expect(appended.isError).toBe(true);
      const block = (appended as { content: Array<{ type: string; text?: string }> }).content.find((b) => b.type === "text");
      expect(block?.text).toBe("task_append_rejected");
    } finally {
      await mcp.close();
    }
  });
});
