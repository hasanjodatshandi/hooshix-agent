import { initializeDatabase } from "./memory/database.js";
import { startHttpServer } from "./mcp/http-server.js";
import { createRuntimeDependencies } from "./core/runtime/composition-root.js";
import { restoreInterruptedTasks } from "./core/recovery/startup-recovery.js";

async function main() {
  console.error("Starting HooshiX Agent V1 (HTTP mode)");

  initializeDatabase();
  const deps = createRuntimeDependencies(); restoreInterruptedTasks(deps.recoveryProvider, deps.recoveryRepository);

  await startHttpServer();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
