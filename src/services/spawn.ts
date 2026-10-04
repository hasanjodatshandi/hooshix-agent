import { execa, type Options } from "execa";
import { spawn as nodeSpawn } from "node:child_process";
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
 *
 * Cancellation and timeout are owned HERE rather than delegated to execa, because
 * execa terminates only the direct child. On Windows that strands descendants:
 * a `node runner -> gradlew -> java` chain leaves the Gradle daemon alive, still
 * holding its `.gradle` file locks, which then breaks every subsequent build
 * ("the first run succeeds, later runs fail"). Terminating through this wrapper
 * kills the whole process tree. The `timedOut` / `isCanceled` flags callers
 * already depend on are set from the real termination reason.
 */
export type SpawnOptions = Record<string, unknown>;

/** A text-mode result: stdout/stderr are always strings (see ExecaResultLike). */
export interface SpawnResult extends Omit<ExecaResultLike, "stdout" | "stderr"> {
  stdout: string;
  stderr: string;
}

/**
 * Best-effort termination of a process and all its descendants.
 *
 * On Windows, `taskkill /T /F` walks the process tree; on POSIX a process-group
 * signal does it. Failure is swallowed: by the time termination runs the process
 * (and its descendants) may already be gone, and a kill error is not actionable
 * to the caller — losing the real outcome is worse than failing to reap a tree.
 */
function killProcessTree(pid: number): void {
  try {
    const killer = process.platform === "win32"
      ? nodeSpawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" })
      : nodeSpawn("kill", ["-TERM", String(pid)], { stdio: "ignore" });
    killer.unref();
    killer.on("error", () => { /* best effort */ });
  } catch {
    /* best effort — see jsdoc */
  }
}

function decorate<T extends ExecaResultLike>(result: T, timedOut: boolean): T {
  // The termination reason is authoritative: when the timer fires we abort via
  // the controller, which execa records as a *cancellation*. Report it as the
  // timeout it actually is so callers keep their existing `timedOut` contract.
  if (timedOut) { result.timedOut = true; result.isCanceled = false; }
  return result;
}

export async function spawn(command: string, args: string[], options: SpawnOptions = {}): Promise<SpawnResult> {
  const rest = { ...options };
  const timeout = typeof rest.timeout === "number" && rest.timeout > 0 ? rest.timeout : undefined;
  const cancelSignal = rest.cancelSignal instanceof AbortSignal ? rest.cancelSignal : undefined;
  delete rest.env;
  delete rest.extendEnv;
  // Owned here so termination reaps the whole tree (see module jsdoc).
  delete rest.timeout;
  delete rest.cancelSignal;

  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pidHolder: { pid: number | undefined } = { pid: undefined };
  const onAbort = () => { if (pidHolder.pid) killProcessTree(pidHolder.pid); };
  controller.signal.addEventListener("abort", onAbort, { once: true });
  // This wrapper registers its tree-kill listener BEFORE handing the signal to
  // execa, so on abort it terminates the descendants first; execa's own
  // listener (registered inside execa()) then reaps an already-dying child.
  const forwardAbort = () => controller.abort();
  let alreadyAborted = false;
  if (cancelSignal) {
    alreadyAborted = cancelSignal.aborted;
    if (!alreadyAborted) cancelSignal.addEventListener("abort", forwardAbort, { once: true });
  }
  if (timeout) timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);

  try {
    const subprocess = execa(command, args, {
      ...rest, encoding: "utf8", extendEnv: false,
      env: buildChildProcessEnvironment(), cancelSignal: controller.signal,
    } as Options);
    if (typeof subprocess.pid === "number" && subprocess.pid > 0) pidHolder.pid = subprocess.pid;
    // A caller may hand over an already-aborted signal. Abort only AFTER the pid
    // is known, otherwise the tree-kill above would have nothing to target.
    if (alreadyAborted) controller.abort();
    const result = await subprocess;
    return decorate(result as unknown as SpawnResult, timedOut);
  } catch (error) {
    // A caller that did not pass `reject: false` sees execa throw on a killed
    // process; keep the termination flags accurate on the way out.
    throw decorate(error as ExecaResultLike, timedOut);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    controller.signal.removeEventListener("abort", onAbort);
    if (cancelSignal && !alreadyAborted) cancelSignal.removeEventListener("abort", forwardAbort);
  }
}
