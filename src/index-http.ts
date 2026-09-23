import { initializeDatabase } from "./memory/database.js";
import { startHttpServer } from "./mcp/http-server.js";
import { createRuntimeDependencies } from "./core/runtime/composition-root.js";
import { restoreInterruptedTasks } from "./core/recovery/startup-recovery.js";
import { recoverInterruptedTasks } from "./core/recovery/crash-recovery.js";
import { createRetentionPolicy } from "./core/memory/database/cleanup.js";
import { startPeriodicRetention } from "./infrastructure/server/retention-scheduler.js";
import { loadAppConfig } from "./infrastructure/config/app-config.js";

async function main() {
  console.error("Starting HooshiX Agent V1 (HTTP mode)");

  // R7.01: the single immutable configuration contract is loaded and validated once
  // at startup, so an invalid or conflicting setting fails immediately. Environment
  // access stays inside the config boundary (R1 architecture contract).
  const config = loadAppConfig(undefined, undefined, "http");

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

  // Active crash recovery: resume interrupted tasks from last completed step
  const recoveryResults = await recoverInterruptedTasks();
  if (recoveryResults.length > 0) {
    console.error(`🔄 Crash recovery complete: ${recoveryResults.filter((r) => r.status === "recovered").length} recovered, ${recoveryResults.filter((r) => r.status === "failed").length} failed`);
  }

  await startHttpServer();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
