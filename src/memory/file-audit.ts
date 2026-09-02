import fs from "node:fs/promises";
import path from "node:path";

function logPath(): string {
  return path.resolve(process.env.HOOSHIX_LOG_DIR ?? "./logs", "file-actions.log");
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
