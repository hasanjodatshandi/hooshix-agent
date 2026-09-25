import { McpServer } from "../adapters/inbound/mcp/legacy-sdk-bridge.js";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { registerTools } from "./registry.js";
import { closeAgentDatabase } from "../core/memory/database/index.js";
import { installGracefulShutdown } from "../infrastructure/server/graceful-shutdown.js";

/** v2 serving entry negotiates 2026 and 2025 stdio protocol eras. */
export async function startMcpServer():Promise<void>{
  // No HTTP listener to drain in stdio mode; still close the database cleanly
  // on termination rather than relying on the default signal action.
  installGracefulShutdown(undefined,{onShutdown:closeAgentDatabase});
  await serveStdio(()=>{
    const server=new McpServer({name:"hooshix-agent",version:"0.1.0"},{capabilities:{tools:{}}});
    registerTools(server);
    return server;
  });
}
