import fs from "node:fs/promises";
import { spawn } from "../spawn.js";
import { packagedOwnerWorkerPath } from "../git/owner-worker-client.js";

export interface WSLWorkerResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  isCanceled?: boolean;
  isMaxBuffer?: boolean;
}

/**
 * A Windows service may NOT launch WSL from LocalSystem. Only a separately
 * user-enrolled WSL worker, authenticated by native pipe ACL and owner SID,
 * can run a Linux command. No fallback to SYSTEM shell is ever permitted.
 */
export async function runOwnerWSLWorker(command: string, windowsRoot: string): Promise<WSLWorkerResult> {
  const executable = packagedOwnerWorkerPath(process.execPath);
  if (!executable || process.platform !== "win32")
    throw new Error("wsl_owner_worker_requires_packaged_windows_service");
  try {
    if (!(await fs.stat(executable)).isFile()) throw new Error("worker not a file");
  } catch {
    throw new Error("wsl_owner_worker_not_installed");
  }
  if (!command || command.length > 6000 || command.includes("\0"))
    throw new Error("wsl_owner_worker_invalid_command");

  const result = await spawn(executable, [
    "-mode", "wsl-proxy", "-root", windowsRoot, "-wsl-command", command,
  ], { cwd: windowsRoot, timeout: 135000, reject: false, shell: false, maxBuffer: 2 * 1024 * 1024 });
  if (result.timedOut) throw new Error("wsl_owner_worker_timeout");
  if (result.exitCode !== 0) throw new Error("wsl_owner_worker_transport_failed");

  let decoded: unknown;
  try { decoded = JSON.parse(result.stdout); }
  catch { throw new Error("wsl_owner_worker_invalid_response"); }
  if (!decoded || typeof decoded !== "object") throw new Error("wsl_owner_worker_invalid_response");
  const value = decoded as Record<string, unknown>;
  if (!Number.isInteger(value.exitCode) || typeof value.stdout !== "string" ||
      typeof value.stderr !== "string" || value.stdout.length + value.stderr.length > 2 * 1024 * 1024)
    throw new Error("wsl_owner_worker_invalid_response");

  return value as unknown as WSLWorkerResult;
}