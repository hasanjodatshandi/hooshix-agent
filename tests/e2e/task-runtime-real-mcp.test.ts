import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { connectTestMcpClient } from "../helpers/mcp-client.js";

function json(result: unknown): any {
  const content = (result as { content?: unknown }).content;
  const block = (content as Array<{ type: string; text?: string }> | undefined)?.find((item) => item.type === "text");
  if (!block?.text) throw new Error("Expected MCP text response");
  return JSON.parse(block.text);
}

describe("real MCP persistent task runtime", () => {
  it("creates, runs, reloads, reports, and remembers an explicit plan", async () => {
    const root = "tests/runtime-mcp-task";
    const correlationId = "real-mcp-task-v1";
    await fs.rm(root, { recursive: true, force: true });
    const client = await connectTestMcpClient();
    try {
      const createdResult = await client.callTool({ name: "task_create", arguments: {
        title: "MCP V1 acceptance",
        description: "ChatGPT supplies the plan; HooshiX executes it locally",
        correlationId,
        steps: [
          { action: "create acceptance script", tool: "create_file", arguments: { path: `${root}/hello.cjs`, content: "console.log('hello-from-mcp-task')" } },
          { action: "execute acceptance script", tool: "execute_command", arguments: { command: "node", args: [`${root}/hello.cjs`] }, dependsOn: [1] }
        ]
      } });
      expect(createdResult.isError).not.toBe(true);
      const created = json(createdResult);

      const runResult = await client.callTool({ name: "task_run", arguments: { taskId: created.id, maxRecovery: 0, correlationId } });
      expect(runResult.isError).not.toBe(true);
      expect(json(runResult).status).toBe("completed");

      const loaded = json(await client.callTool({ name: "task_get", arguments: { taskId: created.id, correlationId } }));
      expect(loaded.steps.map((step: { status: string }) => step.status)).toEqual(["completed", "completed"]);
      expect(JSON.stringify(loaded.steps[1].output)).toContain("hello-from-mcp-task");

      const report = json(await client.callTool({ name: "task_report", arguments: { taskId: created.id, correlationId } }));
      expect(report.status).toBe("completed");
      expect(report.timeline.events.some((event: { type: string; data?: { tool?: string } }) => event.type === "tool_call" && event.data?.tool === "create_file")).toBe(true);

      const project = json(await client.callTool({ name: "project_save", arguments: { name: "Acceptance", path: root, correlationId } }));
      await client.callTool({ name: "memory_add", arguments: { projectId: project.id, taskId: created.id, kind: "acceptance", content: "passed", correlationId } });
      expect(JSON.stringify(json(await client.callTool({ name: "project_list", arguments: { correlationId } })))).toContain("Acceptance");
      expect(JSON.stringify(json(await client.callTool({ name: "memory_list", arguments: { taskId: created.id, correlationId } })))).toContain("passed");
    } finally {
      await client.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 30000);
});
