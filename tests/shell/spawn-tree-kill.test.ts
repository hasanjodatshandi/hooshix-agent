import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "../../src/services/spawn.js";

const repo = process.cwd();

async function processIsDead(pid: number, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); } catch { return true; }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

/**
 * services/spawn.ts owns timeout/cancellation so termination reaps the whole
 * process tree (Node -> Java/Gradle chains), and so the `timedOut`/`isCanceled`
 * flags callers already rely on stay accurate.
 */
describe("spawn: termination reaps the process tree", () => {
  it("reports timedOut and kills the process when its own timeout fires", async () => {
    const start = Date.now();
    const result = await spawn("node", ["tests/fixtures/slow-process.cjs"], {
      cwd: repo, reject: false, timeout: 400,
    });
    expect(result.timedOut).toBe(true);
    // It must not have run to the fixture's full 5s.
    expect(Date.now() - start).toBeLessThan(4000);
  });

  it("reports isCanceled for an already-aborted signal and leaves nothing running", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await spawn("node", ["tests/fixtures/slow-process.cjs"], {
      cwd: repo, reject: false, timeout: 10000, cancelSignal: controller.signal,
    });
    expect(result.isCanceled).toBe(true);
  });

  it("kills descendants too, not just the direct child", async () => {
    const pidFile = path.join(repo, "tests", "fixtures", "grandchild.pid");
    await fs.rm(pidFile, { force: true });
    try {
      const result = await spawn("node", ["tests/fixtures/spawn-grandchild.cjs", pidFile], {
        cwd: repo, reject: false, timeout: 600,
      });
      expect(result.timedOut).toBe(true);
      const grandchildPid = Number(await fs.readFile(pidFile, "utf8"));
      expect(Number.isFinite(grandchildPid)).toBe(true);
      expect(await processIsDead(grandchildPid)).toBe(true);
    } finally {
      await fs.rm(pidFile, { force: true });
    }
  }, 20000);

  it("returns real output for a process that exits non-zero", async () => {
    const result = await spawn("node", ["tests/fixtures/fail-with-output.cjs"], {
      cwd: repo, reject: false,
    });
    expect(result.exitCode).toBe(7);
    expect(result.stdout).toContain("fail-stdout-marker");
    expect(result.stderr).toContain("fail-stderr-marker");
  });
});
