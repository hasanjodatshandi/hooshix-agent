import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Permanent G1 source inventory gate. No exceptions for legacy source:
 * SQL outside SQLite, direct SDK imports outside inbound MCP, process.env
 * outside config, and forbidden Domain/Application/inbound imports block CI.
 * The separate R1 fake-composition + independent-compilation tests cover
 * application dependency inversion; G2/G9 cover runtime tool gateway cutover.
 */
describe("R1 strict global architecture gate", () => {
  it("rejects forbidden source references across the entire src tree", () => {
    const run = spawnSync(process.execPath,
      [path.resolve("scripts/verify-g1-global.mjs"), "--strict"],
      { cwd: process.cwd(), encoding: "utf8", timeout: 30_000 });
    expect(run.error).toBeUndefined();
    expect(run.status, run.stderr || run.stdout).toBe(0);
    const report = JSON.parse(run.stdout) as {
      gate: string; status: string; scannedFiles: number;
      candidateCount: number; categories: Record<string, unknown>;
    };
    expect(report).toMatchObject({
      gate: "G1_GLOBAL", status: "PASS", candidateCount: 0, categories: {},
    });
    expect(report.scannedFiles).toBeGreaterThanOrEqual(160);
  });
});
