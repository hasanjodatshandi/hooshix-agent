import { openAgentDatabase, withAgentDatabase } from "../core/memory/database/index.js";

export function initializeDatabase(): void {
  withAgentDatabase(() => undefined);
}

export function getDatabase() {
  return openAgentDatabase();
}
