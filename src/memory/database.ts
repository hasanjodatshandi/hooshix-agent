import { withAgentDatabase } from "../core/memory/database/index.js";

export function initializeDatabase(): void {
  withAgentDatabase(() => undefined);
}
