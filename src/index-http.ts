import { initializeDatabase } from "./memory/database.js";
import { startHttpServer } from "./mcp/http-server.js";
import { createRuntimeDependencies } from "./core/runtime/composition-root.js";
import { restoreInterruptedTasks } from "./core/recovery/startup-recovery.js";
import { recoverInterruptedTasks } from "./core/recovery/crash-recovery.js";
import { createRetentionPolicy } from "./core/memory/database/cleanup.js";
import { startPeriodicRetention } from "./infrastructure/server/retention-scheduler.js";
import { readLegacyRetentionDays } from "./infrastructure/config/legacy-retention.js";

async function main() {
  console.error("Starting HooshiX Agent V1 (HTTP mode)");

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
