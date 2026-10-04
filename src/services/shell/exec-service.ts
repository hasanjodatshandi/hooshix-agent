import path from "node:path";
import { spawn, type SpawnOptions } from "../spawn.js";
import { logCommandAction } from "../../memory/command-audit.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";
import { assertCwdExists } from "../execa-result.js";
import { assertToolPermission } from "../../security/permission.js";
import { isExecEnabled } from "../../infrastructure/config/exec-enabled-config.js";

/**
 * Named shells an operator may select with the `shell` option. Each maps to an
 * explicit program + flag so the command string is handed to the right
 * interpreter (PowerShell understands `-Command`, POSIX shells understand `-c`,
 * cmd.exe understands `/c`) instead of relying on Node's string-shell handling,
 * which always appends cmd.exe-style flags on Windows.
 */
const SHELL_PROGRAMS: ReadonlyMap<string, { program: string; flag: string }> = new Map([
  ["cmd", { program: "cmd.exe", flag: "/c" }],
  ["powershell", { program: "powershell", flag: "-Command" }],
  ["pwsh", { program: "pwsh", flag: "-Command" }],
  ["bash", { program: "bash", flag: "-c" }],
  ["sh", { program: "sh", flag: "-c" }],
]);

export interface ExecOptions {
  readonly cwd?: string;
  readonly timeout?: number;
  readonly shell?: string;
}

export const EXEC_DEFAULT_TIMEOUT = 60_000;
export const EXEC_MAX_TIMEOUT = 600_000;
export const EXEC_MAX_BUFFER = 16 * 1024 * 1024;

/**
 * Unrestricted shell execution. By deliberate operator decision this path
 * carries NONE of the guards `execute_shell_command` applies: no command
 * allowlist, no dangerous-pattern blocking, no workspace cwd scope, no approval
 * gate. It runs a full shell line — pipes, redirects, builtins, chaining —
 * anywhere on the filesystem, exactly like an interactive terminal.
 *
 * Because the host is network-exposed, the ONLY boundary is who may call it:
 * the highest configured permission level AND an explicit operator opt-in
 * (`HOOSHIX_EXEC_ENABLED=1`, off by default). Everything the command does is
 * still written to the command audit log — that is the point of this tool.
 *
 * The child receives the same allowlisted environment as every other subprocess
 * (see services/spawn.ts): the server's own HOOSHIX_* secrets are never handed
 * to a command, which protects the operator from leaking them into output and
 * logs even by accident.
 */
export async function executeUnrestrictedCommand(
  command: string,
  options: ExecOptions = {},
  correlationId?: string,
  signal?: AbortSignal,
) {
  const traceId = resolveCorrelationId(correlationId);
  const cwd = typeof options.cwd === "string" && options.cwd.length > 0 ? path.resolve(options.cwd) : undefined;
  const named = typeof options.shell === "string" && options.shell.length > 0
    ? SHELL_PROGRAMS.get(options.shell.trim().toLowerCase())
    : undefined;
  const auditCwd = cwd ?? process.cwd();
  const auditArgs = named ? [named.flag] : [];

  // Access gate — the ONLY boundary on this tool. Execution below this point is
  // intentionally unrestricted. A rejected call is still audited: the operator
  // wants a record of every exec attempt, including denied ones.
  try {
    assertToolPermission("exec");
    if (!isExecEnabled()) {
      throw new Error(
        "Access denied: exec is disabled. Set HOOSHIX_EXEC_ENABLED=1 to enable unrestricted shell execution (requires ADMIN_MODE).",
      );
    }
  } catch (error) {
    await logCommandAction({ command, args: auditArgs, cwd: auditCwd, status: "blocked", correlationId: traceId });
    throw error;
  }

  const timeout = Math.min(Math.max(options.timeout ?? EXEC_DEFAULT_TIMEOUT, 100), EXEC_MAX_TIMEOUT);

  try {
    if (cwd !== undefined) assertCwdExists(cwd, "Working directory");

    const base: SpawnOptions = {
      timeout,
      reject: false,
      maxBuffer: EXEC_MAX_BUFFER,
    };
    if (cwd !== undefined) base.cwd = cwd;
    if (signal) base.cancelSignal = signal;

    // A named shell is spawned directly with its own command flag; anything
    // else runs through the platform shell (cmd.exe / /bin/sh), which already
    // understands the full command string.
    const result = named !== undefined
      ? await spawn(named.program, [named.flag, command], { ...base, shell: false })
      : await spawn(command, [], { ...base, shell: options.shell ?? true });

    if (result.timedOut) throw Object.assign(new Error("Command execution timed out"), { timedOut: true });
    if (result.isCanceled || result.exitCode === undefined) {
      throw Object.assign(new Error("Command execution was canceled before it could exit"), { canceled: true });
    }
    const status = result.exitCode === 0 ? "success" : "failed";
    await logCommandAction({ command, args: auditArgs, cwd: auditCwd, exitCode: result.exitCode, status, correlationId: traceId });
    // A non-zero exit is the command's outcome, not a tool failure: return the
    // real exit code and output so the caller sees exactly what happened.
    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      outputTruncated: result.isMaxBuffer === true,
      correlationId: traceId,
    };
  } catch (error) {
    const timedOut = Boolean((error as { timedOut?: boolean }).timedOut);
    await logCommandAction({ command, args: auditArgs, cwd: auditCwd, status: timedOut ? "timeout" : "failed", correlationId: traceId });
    throw error;
  }
}
