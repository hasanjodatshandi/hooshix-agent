import { execa, type Options } from "execa";
import { buildChildProcessEnvironment } from "../infrastructure/config/app-config.js";
import type { ExecaResultLike } from "./execa-result.js";

/**
 * The ONLY way this process may spawn a child. Every subprocess — a shell
 * command, a git invocation, a package manager, a snapshot rollback — runs code
 * its caller chose, and execa extends this process's environment into the child
 * by default (`extendEnv: true`). That would hand a command author the bootstrap
 * token, the OAuth client secret and every other HOOSHIX_* value.
 *
 * This wrapper makes the secure path the only path: the child environment is
 * always the allowlist from `buildChildProcessEnvironment`. Any `env` /
 * `extendEnv` a caller passes is dropped, so the leak cannot be reopened at a
 * call site — and there is exactly one call site to audit. Text mode is forced
 * so every caller can rely on `stdout`/`stderr` being strings.
 */
export type SpawnOptions = Record<string, unknown>;

/** A text-mode result: stdout/stderr are always strings (see ExecaResultLike). */
export interface SpawnResult extends Omit<ExecaResultLike, "stdout" | "stderr"> {
  stdout: string;
  stderr: string;
}

export async function spawn(command: string, args: string[], options: SpawnOptions = {}): Promise<SpawnResult> {
  const rest = { ...options };
  delete rest.env;
  delete rest.extendEnv;
  return execa(command, args, { ...rest, encoding: "utf8", extendEnv: false, env: buildChildProcessEnvironment() } as Options) as unknown as Promise<SpawnResult>;
}
