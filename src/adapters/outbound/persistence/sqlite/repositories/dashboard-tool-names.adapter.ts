import { withAgentDatabase } from "../../../../../core/memory/database/index.js";

/** Dashboard read model owned by SQLite adapter; no SQL in HTTP inbound path. */
export function getRecordedToolNames(): string[] {
  return withAgentDatabase(db => {
    const rows = db.prepare(
      "SELECT DISTINCT tool FROM tool_calls ORDER BY tool"
    ).all() as Array<{ tool: string }>;
    return rows.map(row => row.tool);
  });
}
