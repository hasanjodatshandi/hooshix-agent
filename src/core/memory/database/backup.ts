import fs from "node:fs";
import path from "node:path";
import { openAgentDatabase, getAgentDatabasePath } from "./connection.js";

export async function backupAgentDatabase(destination?: string): Promise<string> {
  const source = getAgentDatabasePath();
  const target = path.resolve(
    destination ??
      path.join(
        path.dirname(source),
        "backups",
        `${path.basename(source)}.${new Date().toISOString().replace(/[:.]/g, "-")}.bak`,
      ),
  );
  if (target === source) throw new Error("Database backup destination must differ from source");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const db = openAgentDatabase();
  await db.backup(target);
  return target;
}
