import { initializeDatabase } from "./memory/database.js";
import { startHttpServer } from "./mcp/http-server.js";
import { createRuntimeDependencies } from "./core/runtime/composition-root.js";
import { restoreInterruptedTasks } from "./core/recovery/startup-recovery.js";
import { recoverInterruptedTasks } from "./core/recovery/crash-recovery.js";
import { cleanupAgentData } from "./core/memory/database.js";

async function main() {
  console.error("Starting HooshiX Agent V1 (HTTP mode)");

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
