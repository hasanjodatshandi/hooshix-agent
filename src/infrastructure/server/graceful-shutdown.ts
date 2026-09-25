import type { Server } from "node:http";
import { terminationGraceMs } from "../config/r3-termination-grace-config.js";

export interface ShutdownHooks {
  onShutdown?: () => void;
}

export interface ShutdownController {
  shutdown(signal: string): void;
}

/**
 * Build the shutdown sequence for one listener. Kept separate from signal
 * wiring so the drain order itself is unit-testable without touching the real
 * process (process.exit cannot be exercised inside a test worker).
 *
 * `server.close()` stops the listener accepting new connections and invokes its
 * callback once every in-flight response has landed. A bounded force timer
 * guarantees termination even if a connection never drains. Only then are
 * resources (the database) released and the process exited — the previous
 * behaviour called process.exit(0) directly and severed handlers mid-response,
 * which could leave a task recorded as "running" forever.
 */
export function createShutdownController(
  server: Server | undefined,
  hooks: ShutdownHooks = {},
  exit: (code: number) => void = (code) => process.exit(code),
): ShutdownController {
  const graceMs = terminationGraceMs();
  let shuttingDown = false;
  let exited = false;
  // release=true runs onShutdown (resources freed only after a clean drain);
  // a forced exit skips it because in-flight handlers may still hold those
  // resources. The guard keeps a late drain callback from exiting again after
  // the force timer already terminated the process.
  const finish = (code: number, release: boolean): void => {
    if (exited) return;
    exited = true;
    if (release) hooks.onShutdown?.();
    exit(code);
  };
  return {
    shutdown(signal: string): void {
      if (shuttingDown) {
        console.error(`${signal} received again; forcing immediate exit`);
        finish(1, false);
        return;
      }
      shuttingDown = true;
      if (!server) {
        console.error(`${signal} received; shutting down`);
        finish(0, true);
        return;
      }
      console.error(`${signal} received; draining in-flight requests (grace ${graceMs}ms)`);
      const force = setTimeout(() => {
        console.error("Shutdown grace period elapsed; forcing exit");
        finish(1, false);
      }, graceMs);
      server.close(() => {
        clearTimeout(force);
        finish(0, true);
      });
    },
  };
}

let installed = false;

/**
 * Owns SIGTERM/SIGINT for the whole process, installed exactly once by the
 * runtime entrypoint. The database adapter used to register these signals and
 * exit immediately, bypassing any drain; that hook is gone and this is the sole
 * terminator.
 */
export function installGracefulShutdown(server: Server | undefined, hooks: ShutdownHooks = {}): void {
  if (installed) return;
  installed = true;
  const controller = createShutdownController(server, hooks);
  process.on("SIGTERM", () => controller.shutdown("SIGTERM"));
  process.on("SIGINT", () => controller.shutdown("SIGINT"));
}
