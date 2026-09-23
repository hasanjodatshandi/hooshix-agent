import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateCommandPermission } from "../../src/security/permissions/command-permission.js";
import { readLegacyHttpAccessToken } from "../../src/infrastructure/config/legacy-http-server.js";

/**
 * R0 baseline remediated contracts. These were originally written as `it.fails`
 * RED contracts for known, live release blockers; each was converted into an
 * ordinary passing regression once its fix landed. Do not delete, skip or weaken
 * them: they pin the remediated behavior permanently.
 * - HIGH-10's frozen-lock negative execution now lives in
 *   tests/core/r8-frozen-lockfile-executed.test.ts (this file keeps the static
 *   Dockerfile recipe assertion).
 * - HIGH-12's endpoint behavior is executed against a real spawned server in
 *   tests/e2e/r5-http-edge-contracts.test.ts (this file keeps the static
 *   source assertion that the route exists).
 */
describe("R0 intentionally failing pre-remediation contracts", () => {
  it("HIGH-03: git diff --no-index cannot bypass scope policy as an auto-approved read", () => {
    const decision = evaluateCommandPermission("git", [
      "diff", "--no-index", "fixture-in-scope.txt", "fixture-out-of-scope.txt",
    ]).decision;
    expect(["blocked", "approval_required"]).toContain(decision);
  });

  it("HIGH-10: Dockerfile must never fall back from a failed frozen-lockfile install", () => {
    const dockerfile = fs.readFileSync(path.resolve("Dockerfile"), "utf8");
    expect(dockerfile).not.toMatch(/\bRUN\s+pnpm\s+install[^\r\n]*\|\|\s*pnpm\s+install/);
  });

  it("HIGH-11: deprecated MCP_ACCESS_TOKEN must no longer be accepted as an unrestricted HTTP bootstrap credential", () => {
    // Test the insecure runtime behavior, not the former location of the env read.
    // R1 relocated this read into infrastructure/config without fixing HIGH-11.
    const credential = readLegacyHttpAccessToken({ MCP_ACCESS_TOKEN: "r0-fixture-bootstrap" });
    expect(credential).toBeUndefined();
  });

  it("HIGH-12: an unauthenticated, non-sensitive liveness endpoint must exist for container health probes", () => {
    const http = fs.readFileSync(path.resolve("src/mcp/http-server.ts"), "utf8");
    expect(http).toContain('path === "/health/live"');
  });

  it("MED-01: HTTP monitoring must reject bearer secrets in query parameters", () => {
    const http = fs.readFileSync(path.resolve("src/mcp/http-server.ts"), "utf8");
    expect(http).not.toMatch(/url\.searchParams\.get\(["'](?:token|access_token)["']\)/);
  });
});