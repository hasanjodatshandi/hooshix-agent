import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateCommandPermission } from "../../src/security/permissions/command-permission.js";

/**
 * R0 baseline RED contracts. Each .fails is a KNOWN, LIVE release blocker:
 * - It is NOT a passing security regression.
 * - It MUST be changed into an ordinary it(...) when the corresponding
 *   implementation is fixed; do not delete or ignore the assertion.
 * - G0/G2/G7 and public HTTP release remain blocked while any .fails remains.
 */
describe("R0 intentionally failing pre-remediation contracts", () => {
  it.fails("HIGH-03: git diff --no-index cannot bypass scope policy as an auto-approved read", () => {
    const decision = evaluateCommandPermission("git", [
      "diff", "--no-index", "fixture-in-scope.txt", "fixture-out-of-scope.txt",
    ]).decision;
    expect(["blocked", "approval_required"]).toContain(decision);
  });

  it.fails("HIGH-10: Dockerfile must never fall back from a failed frozen-lockfile install", () => {
    const dockerfile = fs.readFileSync(path.resolve("Dockerfile"), "utf8");
    expect(dockerfile).not.toMatch(/\bRUN\s+pnpm\s+install[^\r\n]*\|\|\s*pnpm\s+install/);
  });
});
