import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateCommandPermission } from "../../src/security/permissions/command-permission.js";
import { readLegacyHttpAccessToken } from "../../src/infrastructure/config/legacy-http-server.js";

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

  it.fails("HIGH-11: deprecated MCP_ACCESS_TOKEN must no longer be accepted as an unrestricted HTTP bootstrap credential", () => {
    // Test the insecure runtime behavior, not the former location of the env read.
    // R1 relocated this read into infrastructure/config without fixing HIGH-11.
    const credential = readLegacyHttpAccessToken({ MCP_ACCESS_TOKEN: "r0-fixture-bootstrap" });
    expect(credential).toBeUndefined();
  });

  it.fails("HIGH-12: an unauthenticated, non-sensitive liveness endpoint must exist for container health probes", () => {
    const http = fs.readFileSync(path.resolve("src/mcp/http-server.ts"), "utf8");
    expect(http).toContain('path === "/health/live"');
  });

  it.fails("MED-01: HTTP monitoring must reject bearer secrets in query parameters", () => {
    const http = fs.readFileSync(path.resolve("src/mcp/http-server.ts"), "utf8");
    expect(http).not.toMatch(/url\.searchParams\.get\(["'](?:token|access_token)["']\)/);
  });
});