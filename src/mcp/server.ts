import { McpServer } from "../adapters/inbound/mcp/legacy-sdk-bridge.js";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { registerTools } from "./registry.js";

/** v2 serving entry negotiates 2026 and 2025 stdio protocol eras. */
export async function startMcpServer():Promise<void>{
  await serveStdio(()=>{
    const server=new McpServer({name:"hooshix-agent",version:"0.1.0"},{capabilities:{tools:{}}});
    registerTools(server);
    return server;
  });
}
