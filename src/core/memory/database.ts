// Re-export from new database module for backward compatibility
export {
  getAgentDatabasePath,
  openAgentDatabase,
  closeAgentDatabase,
  resetAgentDatabase,
  backupAgentDatabase,
  cleanupAgentData,
  withAgentDatabase,
  ensureColumn,
  migrate,
  runMigrations,
} from "./database/index.js";
