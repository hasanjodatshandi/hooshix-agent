import { describe, expect, it, vi } from "vitest";
import { spawn } from "../../src/services/spawn.js";

/**
 * Cover fail-closed subprocess branches which are security contracts rather
 * than optional code paths: payload caps, stdin delivery, cancel propagation,
 * and subprocess errors. Do not weaken R8.03 coverage floors to green CI.
 */
describe("spawn: security-critical edge cases", () => {
  it("rejects an oversized UTF-8 stdin payload before launching a command", async () => {
    const tooLarge = "é".repeat(1_048_577); // > 2 MiB encoded as UTF-8
    await expect(
      spawn(process.execPath, ["-e", "process.stdout.write('unexpected')"], { input: tooLarge }),
    ).rejects.toThrow("spawn_input_size_limit");
  });

  it("streams bounded Unicode payloads over stdin, not argv", async () => {
    const program = [
      "let data = '';",
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', chunk => { data += chunk; });",
      "process.stdin.on('end', () => process.stdout.write(data));",
    ].join("");
    const input = "subprocess-stdin: سلام";
    const result = await spawn(process.execPath, ["-e", program], { input });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(input);
  });

  it("fails closed if an input payload is supplied without a writable stdin", async () => {
    await expect(
      spawn(process.execPath, ["-e", "process.exit(0)"], {
        input: "must-not-be-discarded",
        stdin: "ignore",
      }),
    ).rejects.toThrow("spawn_stdin_unavailable");
  });

  it("ignores non-text input, invalid cancellation handles, and nonpositive timeouts", async () => {
    const result = await spawn(process.execPath, ["-e", "process.stdout.write('ready')"], {
      input: 42,
      cancelSignal: "not-an-abort-signal",
      timeout: 0,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("ready");
    expect(result.timedOut).not.toBe(true);
  });

  it("preserves the subprocess failure rather than swallowing a rejected execa result", async () => {
    await expect(
      spawn(process.execPath, ["-e", "console.error('spawn-error-probe');process.exit(7)"]),
    ).rejects.toMatchObject({
      exitCode: 7,
      stderr: expect.stringContaining("spawn-error-probe"),
    });
  });

  it("forwards a live cancellation without misclassifying it as a timeout", async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 350);
    try {
      const result = await spawn(process.execPath, ["tests/fixtures/slow-process.cjs"], {
        cwd: process.cwd(),
        cancelSignal: controller.signal,
        reject: false,
      });
      expect(result.isCanceled).toBe(true);
      expect(result.timedOut).not.toBe(true);
    } finally {
      clearTimeout(timer);
    }
  }, 12000);

  // POSIX has a safety fallback when signalling the child process group fails.
  // Exercise it with real cancellation while intercepting ONLY SIGTERM calls.
  it.skipIf(process.platform === "win32")("falls back to killing the direct child when group signalling fails", async () => {
    const originalKill = process.kill.bind(process);
    const attempts: number[] = [];
    const killSpy = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      if (signal === "SIGTERM" && pid < 0) {
        attempts.push(pid);
        throw new Error("simulated group signal refusal");
      }
      if (signal === "SIGTERM" && pid > 0) attempts.push(pid);
      return originalKill(pid, signal);
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 350);
    try {
      const result = await spawn(process.execPath, ["tests/fixtures/slow-process.cjs"], {
        cwd: process.cwd(), cancelSignal: controller.signal, reject: false,
      });
      expect(result.isCanceled).toBe(true);
      expect(result.timedOut).not.toBe(true);
      expect(attempts.some((pid) => pid < 0)).toBe(true);
      expect(attempts.some((pid) => pid > 0)).toBe(true);
    } finally {
      clearTimeout(timer);
      killSpy.mockRestore();
    }
  }, 12000);

  it.skipIf(process.platform === "win32")("does not replace cancellation when both POSIX kill attempts fail", async () => {
    const originalKill = process.kill.bind(process);
    const attempts: number[] = [];
    const killSpy = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      if (signal === "SIGTERM") {
        attempts.push(pid);
        throw new Error("simulated already-exited process");
      }
      return originalKill(pid, signal);
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 350);
    try {
      const result = await spawn(process.execPath, ["tests/fixtures/slow-process.cjs"], {
        cwd: process.cwd(), cancelSignal: controller.signal, reject: false,
      });
      expect(result.isCanceled).toBe(true);
      expect(result.timedOut).not.toBe(true);
      expect(attempts.some((pid) => pid < 0)).toBe(true);
      expect(attempts.some((pid) => pid > 0)).toBe(true);
    } finally {
      clearTimeout(timer);
      killSpy.mockRestore();
    }
  }, 12000);

  // Cover the Windows-only taskkill path on POSIX CI. A Linux runner has no
  // taskkill binary; its asynchronous error must be safely swallowed while
  // execa still cancels the direct child. Always restore the host platform.
  it.skipIf(process.platform === "win32")("handles an unavailable taskkill binary when emulating the Windows kill path", async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    if (!originalPlatform?.configurable) throw new Error("process.platform must be configurable");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 350);
    try {
      Object.defineProperty(process, "platform", {
        configurable: true, enumerable: originalPlatform.enumerable, writable: true, value: "win32",
      });
      const result = await spawn(process.execPath, ["tests/fixtures/slow-process.cjs"], {
        cwd: process.cwd(), cancelSignal: controller.signal, reject: false,
      });
      expect(result.isCanceled).toBe(true);
      expect(result.timedOut).not.toBe(true);
    } finally {
      clearTimeout(timer);
      Object.defineProperty(process, "platform", originalPlatform);
    }
  }, 12000);
});
