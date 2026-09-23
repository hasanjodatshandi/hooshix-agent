import { initializeDatabase } from "./memory/database.js";
import { startMcpServer } from "./mcp/server.js";
import { createRuntimeDependencies } from "./core/runtime/composition-root.js";
import { restoreInterruptedTasks } from "./core/recovery/startup-recovery.js";
import { recoverInterruptedTasks } from "./core/recovery/crash-recovery.js";
import { createRetentionPolicy } from "./core/memory/database/cleanup.js";
import { startPeriodicRetention } from "./infrastructure/server/retention-scheduler.js";
import { loadAppConfig } from "./infrastructure/config/app-config.js";

async function main(){
  console.error("Starting HooshiX Agent V1");

  // R7.01: the single immutable configuration contract is loaded and validated once
  // at startup, so an invalid or conflicting setting fails immediately. Environment
  // access stays inside the config boundary (R1 architecture contract).
  const config = loadAppConfig(undefined, undefined, "stdio");

  initializeDatabase();
  // Run bounded, class-aware retention at startup and every six hours; never delete active records.
  if (config.retentionDays >= 1) {
    startPeriodicRetention({
      policy:createRetentionPolicy(config.retentionDays),
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
