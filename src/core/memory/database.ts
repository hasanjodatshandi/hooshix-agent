// Re-export from new database module for backward compatibility
export {
  getAgentDatabasePath,
  openAgentDatabase,
  closeAgentDatabase,
  resetAgentDatabase,
  resetMigrationsFlag,
  backupAgentDatabase,
  cleanupAgentData,
  withAgentDatabase,
  isDatabaseReady,
  ensureColumn,
  migrate,
  runMigrations,
} from "./database/index.js";
