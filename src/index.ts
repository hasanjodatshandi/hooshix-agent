import { initializeDatabase } from "./memory/database.js";
import { startMcpServer } from "./mcp/server.js";
import { createRuntimeDependencies } from "./core/runtime/composition-root.js";
import { restoreInterruptedTasks } from "./core/recovery/startup-recovery.js";
import { recoverInterruptedTasks } from "./core/recovery/crash-recovery.js";
import { cleanupAgentData } from "./core/memory/database.js";

async function main(){
  console.error("Starting HooshiX Agent V1");

  initializeDatabase();
  // Retention cleanup — runs once at startup; keeps executions/tool_calls/
  // file_backups/recovery_events from growing unboundedly (90-day retention).
  const retentionDays = Number(process.env.HOOSHIX_RETENTION_DAYS ?? 90);
  if (Number.isInteger(retentionDays) && retentionDays >= 1) {
    const deleted = cleanupAgentData(retentionDays);
    const total = Object.values(deleted).reduce((sum, n) => sum + n, 0);
    if (total > 0) console.error(`🧹 Retention cleanup removed ${total} old row(s)`);
  }
  const deps = createRuntimeDependencies(); restoreInterruptedTasks(deps.recoveryProvider, deps.recoveryRepository);
  await recoverInterruptedTasks();

  await startMcpServer();

  console.error("HooshiX MCP server running");
}

main().catch((error)=>{
  console.error(error);
  process.exit(1);
});
