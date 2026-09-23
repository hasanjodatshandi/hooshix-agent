import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { connectTestMcpClient } from "../helpers/mcp-client.js";
import { RUNTIME_FILES_ROOT } from "../helpers/runtime-files.js";
import { withAgentDatabase } from "../../src/core/memory/database.js";

describe("real mcp write tool trace", () => {
  it("propagates correlationId through write_file call", async () => {
    const correlationId = "e2e-write-trace-1";

    const target = `${RUNTIME_FILES_ROOT}/mcp-trace.txt`;
    const client = await connectTestMcpClient();
    try {
      await client.callTool({ name: "write_file", arguments: { path: target, content: "trace", correlationId } });
      const read = await client.callTool({ name: "read_file", arguments: { path: target, correlationId } });
      expect(read.content).toEqual([{ type: "text", text: "trace" }]);
      const modify = await client.callTool({ name: "modify_file", arguments: { path: target, search: "trace", replacement: "updated", correlationId } });
      const search = await client.callTool({ name: "search_files", arguments: { path: RUNTIME_FILES_ROOT, query: "updated", correlationId } });
      const list = await client.callTool({ name: "list_directory", arguments: { path: RUNTIME_FILES_ROOT, correlationId } });
      const system = await client.callTool({ name: "get_system_info", arguments: { correlationId } });
      const command = await client.callTool({ name: "execute_command", arguments: { command: "node", args: ["--version"], correlationId } });
      for (const result of [modify, search, list, system, command]) expect(result.isError).not.toBe(true);
      const failedRead = await client.callTool({ name: "read_file", arguments: { path: `${RUNTIME_FILES_ROOT}/missing.txt`, correlationId } });
      expect(failedRead.isError).toBe(true);
      expect(JSON.stringify(search.content)).toContain("mcp-trace.txt");
      expect(JSON.stringify(list.content)).toContain("mcp-trace.txt");
      const log = await fs.readFile(path.join(process.env.HOOSHIX_LOG_DIR!, "file-actions.log"), "utf8");
      expect(log).toContain(correlationId);
      const actions = log.trim().split("\n").map((line) => JSON.parse(line).action);
      expect(new Set(actions)).toEqual(new Set(["write", "read", "modify", "search", "list"]));
      const commandLog = await fs.readFile(path.join(process.env.HOOSHIX_LOG_DIR!, "command-actions.log"), "utf8");
      expect(commandLog).toContain(correlationId);
      const toolCalls = withAgentDatabase((db) => db.prepare("SELECT tool, status FROM tool_calls WHERE correlation_id = ? ORDER BY id").all(correlationId)) as Array<{ tool: string; status: string }>;
      expect(toolCalls).toHaveLength(8);
      expect(toolCalls.filter((call) => call.status === "success")).toHaveLength(7);
      expect(toolCalls.at(-1)).toEqual({ tool: "read_file", status: "failed" });
    } finally {
      await client.close();
      await fs.rm(path.dirname(target), { recursive: true, force: true });
    }
  }, 30000);
});
