import { McpServer } from "../adapters/inbound/mcp/legacy-sdk-bridge.js";
import { StdioServerTransport } from "../adapters/inbound/mcp/legacy-sdk-bridge.js";
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