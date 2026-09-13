import fs from "node:fs";

/**
 * Minimal structural view of an execa result (or ExecaError with reject:false)
 * so helpers stay decoupled from the execa version's exact types.
 */
export interface ExecaResultLike {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
  isCanceled?: boolean;
  shortMessage?: string;
  originalMessage?: string;
}

/**
 * Pre-validate a working directory before spawning a process.
 *
 * execa with `reject: false` RESOLVES (never throws) when the cwd does not
 * exist: the result has `exitCode: undefined` and empty stderr, which used to
 * surface as the misleading "<cmd> exited with code undefined". Fail fast with
 * an accurate message instead.
 */
export function assertCwdExists(cwd: string, label = "Working directory"): void {
  if (!fs.existsSync(cwd)) {
    throw new Error(`${label} does not exist: ${cwd}`);
  }
}

/**
 * Build a precise error message from an execa result that did not exit 0.
 *
 * Covers:
 * - user/abort-signal cancellation (isCanceled)
 * - spawn failures such as ENOENT/EACCES (shortMessage / originalMessage)
 * - normal non-zero exits with stderr
 */
export function describeExecaFailure(command: string, result: ExecaResultLike): string {
  if (result.isCanceled) return `${command} was cancelled before it completed`;
  const stderr = (result.stderr ?? "").trim();
  const spawnDetail = result.shortMessage ?? result.originalMessage;
  const detail = stderr || spawnDetail || "no output captured";
  return `${command} exited with code ${result.exitCode}: ${detail}`;
}
