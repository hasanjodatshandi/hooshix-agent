import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./registry.js";

export async function startMcpServer(){
  const server = new McpServer({
    name: "hooshix-agent",
    version: "0.1.0"
  });

  registerTools(server);

  const transport = new StdioServerTransport();

  await server.connect(transport);
}
