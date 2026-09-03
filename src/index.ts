import { initializeDatabase } from "./memory/database.js";
import { startMcpServer } from "./mcp/server.js";
import { createRuntimeDependencies } from "./core/runtime/composition-root.js";
import { restoreInterruptedTasks } from "./core/recovery/startup-recovery.js";

async function main(){
  console.error("Starting HooshiX Agent V1");

  initializeDatabase();
  restoreInterruptedTasks(createRuntimeDependencies().recoveryProvider);

  await startMcpServer();

  console.error("HooshiX MCP server running");
}

main().catch((error)=>{
  console.error(error);
  process.exit(1);
});
