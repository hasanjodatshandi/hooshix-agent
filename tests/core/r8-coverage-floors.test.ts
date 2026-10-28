import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * R8.03 — per-file coverage floors for security-critical modules. The project's
 * aggregate thresholds (80/75/85/85 in vitest.config.ts) cannot detect a
 * regression that is invisible in the average: a single security module could
 * drop to near-zero while the total stays green. This test reads the coverage
 * summary produced by `pnpm run test:coverage` and enforces an explicit floor
 * on every module that enforces a security boundary or a reliability contract.
 *
 * Floors are deliberately set BELOW the current measured values so the test
 * catches real regressions without being so tight that a harmless refactor
 * fails it. When a module's measured coverage rises materially above its floor,
 * raise the floor toward the new value. Cross-platform adjustments require
 * actual CI coverage evidence and explicit review; never weaken them silently.
 *
 * A plain `vitest run` may lack a summary; in that mode report NOT ENFORCED.
 * CI must rerun this test after `test:coverage` with the mandatory env flag,
 * so missing coverage evidence fails closed rather than producing false green.
 */

interface FileCoverage {
  statements: { pct: number };
  branches: { pct: number };
  functions: { pct: number };
  lines: { pct: number };
}
type Summary = Record<string, FileCoverage> & { total: FileCoverage };

/** Each entry is a security/reliability-critical module and its agreed floor. */
const SECURITY_FLOORS: ReadonlyArray<{ file: string; statements: number; branches: number }> = [
  // Authorization and workspace boundary — a hole here is HIGH-01/HIGH-02.
  { file: "src/security/workspace-guard.ts", statements: 90, branches: 80 },
  { file: "src/application/services/authorization-service.ts", statements: 85, branches: 85 },
  { file: "src/application/services/sensitive-path-policy.ts", statements: 95, branches: 90 },
  { file: "src/application/services/legacy-command-policy.ts", statements: 85, branches: 85 },
  { file: "src/security/permission.ts", statements: 95, branches: 90 },
  { file: "src/security/task-workspace.ts", statements: 75, branches: 60 },
  { file: "src/domain/workspace/workspace-scope.ts", statements: 60, branches: 70 },
  // The central authorization gate and the child-process choke-point.
  { file: "src/core/governance/policy-decision-point.ts", statements: 85, branches: 85 },
  // Linux CI recorded 91.66% statements versus 95% on Windows (OS-specific
  // process-tree termination paths); 90% is the reviewed cross-platform floor.
  { file: "src/services/spawn.ts", statements: 90, branches: 90 },
  { file: "src/core/executor/local-tool-executor.ts", statements: 85, branches: 60 },
  // OAuth / transport security — HIGH-04/HIGH-11/HIGH-12.
  // NOTE: src/mcp/http-server.ts is intentionally NOT floored here. It is
  // excluded from V8 coverage (E2E runs it as a child process, whose coverage
  // is not merged). Its behaviour is guarded by tests/security/r5-* instead.
  { file: "src/infrastructure/server/http-security.ts", statements: 90, branches: 90 },
  // Crash / recovery / lease — HIGH-05/HIGH-06/HIGH-07/HIGH-13.
  { file: "src/core/recovery/crash-recovery.ts", statements: 85, branches: 70 },
  { file: "src/core/recovery/task-reconciliation.ts", statements: 80, branches: 70 },
  { file: "src/core/runtime/task-lease-runner.ts", statements: 60, branches: 70 },
  // R-P19: the REAL durable-lease logic. This floor previously pointed at
  // src/core/memory/task-lease.ts, a 2-line `export *` facade whose coverage
  // is trivially 100% — so the floor enforced nothing about the adapter.
  { file: "src/adapters/outbound/persistence/sqlite/repositories/task-lease.adapter.ts", statements: 60, branches: 60 },
  // Config — a silent misparse here splits the whole service (R7.01).
  { file: "src/infrastructure/config/app-config.ts", statements: 90, branches: 85 },
];

describe("R8.03 per-file coverage floors for security-critical modules", () => {
  const summaryPath = path.resolve("coverage", "coverage-summary.json");

  it("enforces a statements and branches floor on every listed module", () => {
    const mandatory = process.env.HOOSHIX_REQUIRE_R803_COVERAGE_FLOORS === "1";
    if (!fs.existsSync(summaryPath)) {
      if (mandatory) throw new Error("R8.03: required coverage/coverage-summary.json is absent");
      console.log("R8.03 NOT ENFORCED: coverage summary absent (run pnpm run test:coverage)");
      return;
    }
    const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8")) as Summary;
    // The v8 provider keys the summary with OS-native separators; normalize
    // both the lookup key and the stored keys so the test is portable.
    const norm = (p: string) => path.resolve(p).replace(/\\/g, "/").toLowerCase();
    const byNormalizedKey = new Map<string, FileCoverage>();
    for (const [key, value] of Object.entries(summary)) {
      if (key !== "total") byNormalizedKey.set(norm(key), value);
    }

    const failures: string[] = [];
    for (const { file, statements, branches } of SECURITY_FLOORS) {
      const entry = byNormalizedKey.get(norm(file));
      if (!entry) {
        failures.push(`${file}: MISSING from coverage summary (excluded or never imported)`);
        continue;
      }
      if (entry.statements.pct < statements)
        failures.push(`${file}: statements ${entry.statements.pct}% < floor ${statements}%`);
      if (entry.branches.pct < branches)
        failures.push(`${file}: branches ${entry.branches.pct}% < floor ${branches}%`);
    }
    expect(failures, failures.join("\n")).toEqual([]);
    if (mandatory) console.log(`R8.03 ENFORCED: ${SECURITY_FLOORS.length} security-critical module floors passed`);
  });

  it("CI runs the mandatory R8.03 check against a freshly generated summary", () => {
    const workflow = fs.readFileSync(path.resolve(".github/workflows/ci.yml"), "utf8");
    const start = workflow.indexOf("- name: Per-file coverage evidence");
    const end = workflow.indexOf("- name: Active deployment and tracked secret policy", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const step = workflow.slice(start, end);
    const commands = [
      "rm -f coverage/coverage-summary.json",
      "pnpm run test:coverage --maxWorkers=1 --no-file-parallelism",
      "test -s coverage/coverage-summary.json",
      "HOOSHIX_REQUIRE_R803_COVERAGE_FLOORS=1 pnpm exec vitest run tests/core/r8-coverage-floors.test.ts --maxWorkers=1 --no-file-parallelism",
    ];
    let prior = -1;
    for (const command of commands) {
      const position = step.indexOf(command);
      expect(position, command).toBeGreaterThan(prior);
      prior = position;
    }
  });

  it("the floor list stays in sync with the files that actually exist", () => {
    // A floor pointing at a deleted file would silently stop enforcing anything.
    const stale = SECURITY_FLOORS.filter(({ file }) => !fs.existsSync(path.resolve(file)));
    expect(stale.map((s) => s.file)).toEqual([]);
  });
});
