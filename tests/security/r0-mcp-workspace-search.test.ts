import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { connectInProcessMcp, json } from "../helpers/in-process-mcp.js";
import { createDisposableFixture, type DisposableFixture } from "../helpers/r0-disposable-fixtures.js";
import {
  addWorkspaceRoots, getWorkspaceRoot, listWorkspaceRoots,
  removeWorkspaceRoot, setActiveWorkspace,
} from "../../src/security/workspace-guard.js";
import { createTaskRuntimeService } from "../../src/core/runtime/composition-root.js";

const repo = process.cwd();
let fixture: DisposableFixture | undefined;
afterEach(() => {
  setActiveWorkspace(repo);
  if (fixture) {
    const root = fixture.root;
    try { removeWorkspaceRoot(root); } catch { /* global test setup restores roots before next test */ }
    fixture.cleanup();
    fixture = undefined;
  }
});

describe("R0 real MCP and Task workspace/security contracts", () => {
  it.fails("HIGH-01: a direct MCP client cannot add a new persistent root without principal-bound authorization", async () => {
    fixture = createDisposableFixture("scope");
    const mcp = await connectInProcessMcp();
    try {
      const before = listWorkspaceRoots().map((r) => r.path.toLowerCase());
      const result = await mcp.client.callTool({
        name: "add_workspace_roots", arguments: { paths: [fixture.root] },
      });
      const after = listWorkspaceRoots().map((r) => r.path.toLowerCase());
      expect(result.isError).toBe(true);
      expect(after).toEqual(before);
    } finally { await mcp.close(); }
  });

  it("HIGH-01: a revoked Task root cannot be replaced by another active workspace", async () => {
    fixture = createDisposableFixture("taskroot");
    fs.writeFileSync(path.join(fixture.root, "proof.txt"), "isolated");
    addWorkspaceRoots([fixture.root]);
    setActiveWorkspace(fixture.root);
    const runtime = createTaskRuntimeService();
    const plan = runtime.create({ title: "R0 revoked workspace", steps: [{
      action: "read fixture file", tool: "read_file", arguments: { path: "proof.txt" },
    }] });
    setActiveWorkspace(repo);
    removeWorkspaceRoot(fixture.root);
    await expect(runtime.run(plan.id, 0)).rejects.toThrow(/WORKSPACE_CONTEXT_INVALID|ROOT_NO_LONGER_ALLOWED|not (?:allowed|authorized)/i);
    expect(runtime.get(plan.id)?.steps[0].status).toBe("pending");
    expect(getWorkspaceRoot()?.toLowerCase()).toBe(repo.toLowerCase());
  });

  it("HIGH-02: real MCP search excludes secrets while still returning ordinary files", async () => {
    fixture = createDisposableFixture("secrets");
    const key = "r0-credential-fixture-" + Date.now();
    for (const rel of [".env", ".token", ".ssh/id_rsa", ".aws/credentials", ".azure/credentials", "secret.pem"]) {
      const file = path.join(fixture.root, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, key);
    }
    fs.writeFileSync(path.join(fixture.root, "normal.txt"), key);
    addWorkspaceRoots([fixture.root]);
    setActiveWorkspace(fixture.root);
    const mcp = await connectInProcessMcp();
    try {
      const response = await mcp.client.callTool({ name: "search_files", arguments: { path: ".", query: key } });
      expect(response.isError).not.toBe(true);
      const result = json(response) as { matches: Array<{ path: string; text: string }> };
      expect(result.matches.map((x) => x.path.replace(/\\/g, "/"))).toEqual(["normal.txt"]);
      expect(result.matches.map((x) => x.text)).toEqual([key]);
    } finally { await mcp.close(); }
  });

  it("HIGH-02: a read-only Task search also excludes sensitive files", async () => {
    fixture = createDisposableFixture("tasksearch");
    const key = "r0-secret-scope-" + Date.now();
    fs.writeFileSync(path.join(fixture.root, ".env"), key);
    fs.writeFileSync(path.join(fixture.root, "normal.txt"), key);
    addWorkspaceRoots([fixture.root]);
    setActiveWorkspace(fixture.root);
    const runtime = createTaskRuntimeService();
    const plan = runtime.create({ title: "R0 sensitive Task search", steps: [{
      action: "safe search", tool: "search_files", arguments: { path: ".", query: key },
    }] });
    const result = await runtime.run(plan.id, 0);
    expect(result.status).toBe("completed");
    const output = runtime.get(plan.id)?.steps[0].output;
    expect(JSON.stringify(output)).toContain("normal.txt");
    expect(JSON.stringify(output)).not.toContain(".env");
  });
});
