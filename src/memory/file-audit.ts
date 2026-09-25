import fs from "node:fs/promises";
import path from "node:path";
import { readLegacyRuntimePaths } from "../infrastructure/config/legacy-runtime-paths.js";

function logPath(): string {
  return path.resolve(readLegacyRuntimePaths().logDirectory, "file-actions.log");
}

/** Rotate once the log exceeds this size, mirroring the command-audit bound. */
const MAX_LOG_BYTES = 10 * 1024 * 1024; // 10 MiB

async function rotateIfNeeded(destination: string): Promise<void> {
  let size: number;
  try { size = (await fs.stat(destination)).size; } catch { return; } // absent on first write
  if (size < MAX_LOG_BYTES) return;
  await fs.rename(destination, destination + ".1");
}

export async function logFileAction(
  action: string,
  targetPath: string,
  correlationId: string,
  status: "success" | "failed" = "success"
): Promise<void> {
  const destination = logPath();
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await rotateIfNeeded(destination);
  await fs.appendFile(destination, JSON.stringify({
    action,
    path: targetPath,
    correlationId,
    status,
    timestamp: new Date().toISOString()
  }) + "\n", "utf8");
}
