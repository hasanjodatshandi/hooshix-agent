import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "../spawn.js";

export interface OwnerWorkerResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Only a packaged, ACL-protected worker beside the bundled Node runtime is
 * eligible. No tool request can supply a proxy executable or override it.
 */
export function packagedOwnerWorkerPath(executablePath: string, platform = process.platform): string | null {
  if (platform !== "win32") return null;
  const winPath = path.win32;
  const runtimeDir = winPath.dirname(executablePath);
  if (winPath.basename(runtimeDir).toLowerCase() !== "runtime") return null;
  if (winPath.basename(executablePath).toLowerCase() !== "node.exe") return null;
  return winPath.resolve(runtimeDir, "..", "bin", "hooshix-git-worker.exe");
}

export async function runOwnerWorker(
  tool: string, args: string[], root: string,
): Promise<OwnerWorkerResult | null> {
  const executable = packagedOwnerWorkerPath(process.execPath);
  if (!executable) return null;
  try {
    const stat = await fs.stat(executable);
    if (!stat.isFile()) return null;
  } catch {
    return null;
  }
  const result = await spawn(executable, [
    "-mode", "proxy", "-root", root, "-tool", tool, "--", ...args,
  ], {
    cwd: root, shell: false, reject: false, timeout: 25000,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.timedOut) throw new Error("owner_git_worker_timeout");
  if (result.exitCode !== 0) throw new Error("owner_git_worker_unavailable");
  let parsed: unknown;
  try { parsed = JSON.parse(result.stdout); } catch {
    throw new Error("owner_git_worker_invalid_response");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("owner_git_worker_invalid_response");
  const value = parsed as Record<string, unknown>;
  if (!Number.isInteger(value.exitCode) || typeof value.stdout !== "string" ||
      typeof value.stderr !== "string" || value.stdout.length + value.stderr.length > 2 * 1024 * 1024) {
    throw new Error("owner_git_worker_invalid_response");
  }
  return value as unknown as OwnerWorkerResult;
}
