import { initializeDatabase } from "./memory/database.js";
import { startMcpServer } from "./mcp/server.js";

async function main(){
  console.error("Starting HooshiX Agent V1");

  initializeDatabase();

  await startMcpServer();

  console.error("HooshiX MCP server running");
}

main().catch((error)=>{
  console.error(error);
  process.exit(1);
});
