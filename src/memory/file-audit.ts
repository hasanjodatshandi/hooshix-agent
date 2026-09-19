import fs from "node:fs/promises";
import path from "node:path";
import { readLegacyRuntimePaths } from "../infrastructure/config/legacy-runtime-paths.js";

function logPath(): string {
  return path.resolve(readLegacyRuntimePaths().logDirectory, "file-actions.log");
}

export async function logFileAction(
  action: string,
  targetPath: string,
  correlationId: string,
  status: "success" | "failed" = "success"
): Promise<void> {
  const destination = logPath();
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.appendFile(destination, JSON.stringify({
    action,
    path: targetPath,
    correlationId,
    status,
    timestamp: new Date().toISOString()
  }) + "\n", "utf8");
}
