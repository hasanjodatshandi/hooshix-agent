import { execa } from "execa";
import { validateWorkspace } from "../../security/workspace-guard.js";
import { assertAdminPermission, assertToolPermission } from "../../security/permission.js";
import { logCommandAction } from "../../memory/command-audit.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";

export type PackageManager = "npm" | "pnpm" | "pip" | "winget" | "choco";
export type PackageAction = "install" | "remove" | "update";

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
  assertToolPermission("package_manage");
  if (input.manager === "winget" || input.manager === "choco") assertAdminPermission();
  const name = validatePackageName(input.name);
  const cwd = validateWorkspace(input.cwd ?? ".");
  const traceId = resolveCorrelationId(input.correlationId);
  const { command, args } = commandFor(input.manager, input.action, name);
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
  return { manager: input.manager, action: input.action, name, verified, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, correlationId: traceId };
}
