import { execa } from "execa";
import { validateWorkspace } from "../../security/workspace-guard.js";
import { assertAdminPermission } from "../../security/permission.js";
import { policyDecisionPoint } from "../../core/governance/policy-decision-point.js";
import { logCommandAction } from "../../memory/command-audit.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { withAgentDatabase } from "../../core/memory/database.js";

export type PackageManager = "npm" | "pnpm" | "pip" | "winget" | "choco";
export type PackageAction = "install" | "remove" | "update";

interface PackageSnapshotFile { path: string; existed: boolean; content?: string }
interface PackageSnapshot { id: string; files: PackageSnapshotFile[] }

const SNAPSHOT_FILES: Record<PackageManager, readonly string[]> = {
  npm: ["package.json", "package-lock.json", "npm-shrinkwrap.json"],
  pnpm: ["package.json", "pnpm-lock.yaml"],
  pip: ["requirements.txt", "pyproject.toml", "poetry.lock", ".python-version"],
  winget: [],
  choco: []
};
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;

async function createPackageSnapshot(manager: PackageManager, action: PackageAction, name: string, cwd: string, correlationId: string): Promise<PackageSnapshot> {
  const id = randomUUID();
  const files: PackageSnapshotFile[] = [];
  let bytes = 0;
  for (const relative of SNAPSHOT_FILES[manager]) {
    const file = path.join(cwd, relative);
    const content = await fs.readFile(file).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? undefined : Promise.reject(error));
    if (content) {
      bytes += content.byteLength;
      if (bytes > MAX_SNAPSHOT_BYTES) throw new Error("Package snapshot exceeds the 8 MiB limit");
      files.push({ path: relative, existed: true, content: content.toString("base64") });
    } else {
      files.push({ path: relative, existed: false });
    }
  }
  withAgentDatabase((db) => db.prepare(`
    INSERT INTO package_snapshots(id, correlation_id, manager, action, package_name, cwd, snapshot, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'created', ?)
  `).run(id, correlationId, manager, action, name, cwd, JSON.stringify({
    files,
    environment: { platform: process.platform, architecture: process.arch, nodeVersion: process.version, manager }
  }), new Date().toISOString()));
  return { id, files };
}

async function restorePackageSnapshot(snapshot: PackageSnapshot, cwd: string): Promise<void> {
  for (const item of snapshot.files) {
    const destination = path.join(cwd, item.path);
    if (!item.existed) {
      await fs.rm(destination, { force: true });
      continue;
    }
    const temporary = `${destination}.${randomUUID()}.rollback`;
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(temporary, Buffer.from(item.content!, "base64"), { flag: "wx" });
    await fs.rename(temporary, destination);
  }
}

function updateSnapshot(id: string, status: "committed" | "rolled_back" | "rollback_failed"): void {
  withAgentDatabase((db) => db.prepare("UPDATE package_snapshots SET status=?, restored_at=? WHERE id=?")
    .run(status, status === "committed" ? null : new Date().toISOString(), id));
}

export function validatePackageName(name: string): string {
  if (!/^[A-Za-z0-9@][A-Za-z0-9@._/-]{0,213}$/.test(name) || name.includes("..")) throw new Error("Invalid package name");
  return name;
}

export function commandFor(manager: PackageManager, action: PackageAction, packageName: string): { command: string; args: string[] } {
  if (manager === "npm") return { command: "npm", args: [action === "remove" ? "uninstall" : action, packageName] };
  if (manager === "pnpm") return { command: "pnpm", args: [action === "install" ? "add" : action, packageName] };
  if (manager === "pip") return { command: "python", args: ["-m", "pip", action === "remove" ? "uninstall" : "install", ...(action === "remove" ? ["-y"] : action === "update" ? ["--upgrade"] : []), packageName] };
  if (manager === "winget") return { command: "winget", args: [action === "remove" ? "uninstall" : action === "update" ? "upgrade" : "install", "--id", packageName, "--exact", "--accept-source-agreements"] };
  return { command: "choco", args: [action === "remove" ? "uninstall" : action === "update" ? "upgrade" : "install", packageName, "-y"] };
}

function verificationName(manager: PackageManager, packageName: string): string {
  if (manager !== "npm" && manager !== "pnpm") return packageName;
  const versionSeparator = packageName.lastIndexOf("@");
  return versionSeparator > 0 ? packageName.slice(0, versionSeparator) : packageName;
}

export function verificationCommandFor(manager: PackageManager, packageName: string): { command: string; args: string[] } {
  const name = verificationName(manager, packageName);
  if (manager === "npm") return { command: "npm", args: ["list", name, "--depth=0", "--json"] };
  if (manager === "pnpm") return { command: "pnpm", args: ["list", name, "--depth=0", "--json"] };
  if (manager === "pip") return { command: "python", args: ["-m", "pip", "show", packageName] };
  if (manager === "winget") return { command: "winget", args: ["list", "--id", packageName, "--exact", "--accept-source-agreements"] };
  return { command: "choco", args: ["list", "--local-only", "--exact", packageName] };
}

export async function managePackage(input: { manager: PackageManager; action: PackageAction; name: string; cwd?: string; timeout?: number; correlationId?: string }) {
  const tool = `${input.action === "install" ? "install" : input.action === "remove" ? "remove" : "update"}_package`;
  policyDecisionPoint.assertAllowed({ tool, arguments: input as unknown as Record<string, unknown>, correlationId: input.correlationId });
  if (input.manager === "winget" || input.manager === "choco") assertAdminPermission();
  const name = validatePackageName(input.name);
  const cwd = validateWorkspace(input.cwd ?? ".");
  const traceId = resolveCorrelationId(input.correlationId);
  const snapshot = await createPackageSnapshot(input.manager, input.action, name, cwd, traceId);
  const { command, args } = commandFor(input.manager, input.action, name);
  try {
    const result = await execa(command, args, { cwd, shell: false, reject: false, timeout: input.timeout ?? 300000, maxBuffer: 2 * 1024 * 1024 });
    await logCommandAction({ command, args, cwd, exitCode: result.exitCode, status: result.timedOut ? "timeout" : result.exitCode === 0 ? "success" : "failed", correlationId: traceId });
    if (result.timedOut) throw new Error("Package operation timed out");
    if (result.exitCode !== 0) throw new Error(result.stderr || `${command} exited with code ${result.exitCode}`);

    const verification = verificationCommandFor(input.manager, name);
    const checked = await execa(verification.command, verification.args, { cwd, shell: false, reject: false, timeout: Math.min(input.timeout ?? 300000, 120000), maxBuffer: 2 * 1024 * 1024 });
    if (checked.timedOut) {
      await logCommandAction({ command: verification.command, args: verification.args, cwd, exitCode: checked.exitCode, status: "timeout", correlationId: traceId });
      throw new Error("Package verification timed out");
    }
    const verificationOutput = `${checked.stdout}\n${checked.stderr}`.toLowerCase();
    const explicitlyAbsent = /no installed package|not found|0 packages/.test(verificationOutput);
    const expectedName = verificationName(input.manager, name).toLowerCase();
    const comparableOutput = input.manager === "pip" ? verificationOutput.replace(/[._-]+/g, "-") : verificationOutput;
    const comparableName = input.manager === "pip" ? expectedName.replace(/[._-]+/g, "-") : expectedName;
    const present = checked.exitCode === 0 && !explicitlyAbsent && comparableOutput.includes(comparableName);
    const verified = input.action === "remove" ? !present : present;
    await logCommandAction({ command: verification.command, args: verification.args, cwd, exitCode: checked.exitCode, status: verified ? "success" : "failed", correlationId: traceId });
    if (!verified) throw new Error(`Package ${input.action} completed but verification failed for ${name}`);
    updateSnapshot(snapshot.id, "committed");
    return { manager: input.manager, action: input.action, name, verified, snapshotId: snapshot.id, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, correlationId: traceId };
  } catch (error) {
    try {
      await restorePackageSnapshot(snapshot, cwd);
      updateSnapshot(snapshot.id, "rolled_back");
    } catch {
      updateSnapshot(snapshot.id, "rollback_failed");
      throw new Error(`Package operation failed and rollback failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    throw error;
  }
}
