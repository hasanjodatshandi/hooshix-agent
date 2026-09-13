/**
 * In-process MCP server harness: registers the real tools on a real McpServer
 * over an in-memory transport so tool handlers (src/tools/**) get coverage
 * without spawning child processes.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerTools } from "../../src/mcp/registry.js";

export async function connectInProcessMcp(): Promise<{ client: Client; server: McpServer; close(): Promise<void> }> {
  const server = new McpServer({ name: "test-server", version: "0.1.0" });
  registerTools(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "in-process-test", version: "0.1.0" });
  await client.connect(clientTransport);
  return {
    client,
    server,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

export function json(result: unknown): any {
  const content = (result as { content?: unknown }).content;
  const block = (content as Array<{ type: string; text?: string }> | undefined)?.find((item) => item.type === "text");
  if (!block?.text) throw new Error("Expected MCP text response");
  return JSON.parse(block.text);
}
