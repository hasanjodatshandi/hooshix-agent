import { initializeDatabase } from "./memory/database.js";
import { startMcpServer } from "./mcp/server.js";
import { createRuntimeDependencies } from "./core/runtime/composition-root.js";
import { restoreInterruptedTasks } from "./core/recovery/startup-recovery.js";
import { recoverInterruptedTasks } from "./core/recovery/crash-recovery.js";
import { createRetentionPolicy } from "./core/memory/database/cleanup.js";
import { startPeriodicRetention } from "./infrastructure/server/retention-scheduler.js";
import { readLegacyRetentionDays } from "./infrastructure/config/legacy-retention.js";

async function main(){
  console.error("Starting HooshiX Agent V1");

  initializeDatabase();
  // Run bounded, class-aware retention at startup and every six hours; never delete active records.
  const retentionDays = readLegacyRetentionDays();
  if (Number.isInteger(retentionDays) && retentionDays >= 1) {
    startPeriodicRetention({
      policy:createRetentionPolicy(retentionDays),
      onReport:report=>{
        if(report.total>0)console.error("Retention cleanup removed "+report.total+" expired row(s)");
      },
      onError:error=>console.error("Retention cleanup failed:",error),
    });
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
