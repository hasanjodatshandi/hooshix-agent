import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readHttpBootstrapSecret, readHttpSecurityConfig } from "../../src/infrastructure/config/legacy-http-server.js";

const read = (name: string) => fs.readFileSync(path.resolve(name), "utf8");
describe("R7 deployment security contracts", () => {
  it("Docker installs only from the frozen lock and runs the application non-root", () => {
    const docker = read("Dockerfile");
    expect(docker).toContain("pnpm install --frozen-lockfile");
    expect(docker).toContain("pnpm install --prod --frozen-lockfile");
    expect(docker).not.toMatch(/\bRUN\s+pnpm\s+install[^\r\n]*\|\|/);
    expect(docker).toMatch(/^USER node\s*$/m);
    expect(docker).toContain("chown node:node /app/data");
    expect(docker).toContain("HOOSHIX_BOOTSTRAP_TOKEN_FILE=/app/data/.token");
    expect(docker).toContain("HOOSHIX_DB_PATH=/app/data/agent-memory.db");
    expect(docker).toContain("/health/live");
    expect(docker).not.toContain("MCP_API_KEY=your-secret");
  });
  it("R7.06 pins both build stages to a digest of the exact Node line", () => {
    const docker = read("Dockerfile");
    const fromLines = [...docker.matchAll(/^FROM\s+(\S+)(?:\s+AS\s+\w+)?\s*$/gm)].map(m => m[1]);
    expect(fromLines.length, docker).toBeGreaterThanOrEqual(2);
    for (const ref of fromLines) {
      expect(ref).toMatch(/^node:24\.18\.0-slim@sha256:[0-9a-f]{64}$/);
    }
    // Digest and provenance are recorded in the deployment pinning document.
    const doc = read("docs/implementation/R7_DEPLOYMENT_PINNING_2026-09-23.md");
    for (const ref of fromLines) expect(doc).toContain(ref);
    expect(read(".nvmrc").trim()).toBe("24.18.0");
  });
  it("Docker build context excludes operator secrets, workspaces and database backups", () => {
    const ignore = read(".dockerignore");
    for (const pattern of [".token", "**/.token", ".env", "**/.env", "data", "**/backups/**"]) {
      expect(ignore.split(/\r?\n/)).toContain(pattern);
    }
  });
  it("watchdog probes unauthenticated liveness without injecting obsolete credential", () => {
    const watchdog = read("scripts/hooshix_nodejs_mcp_watchdog.ps1");
    expect(watchdog).toContain("/health/live");
    expect(watchdog).not.toContain('EnvironmentVariables["MCP_ACCESS_TOKEN"]');
    expect(watchdog).not.toContain('Authorization"] = "Bearer');
    expect(read("scripts/start_nodejs_mcp.bat")).toContain("/health/live");
  });
  it("Compose does not expose the MCP backend publicly or resurrect the retired key", () => {
    const compose = read("docker-compose.yml");
    expect(compose).toContain('127.0.0.1:3001:3001');
    expect(compose).toContain("HOOSHIX_PUBLIC_BASE_URL=${HOOSHIX_PUBLIC_BASE_URL:?");
    expect(compose).toContain("HOOSHIX_HTTP_HOST=0.0.0.0");
    expect(compose).not.toMatch(/^\s*- MCP_API_KEY=/m);
    expect(compose).toContain("/health/live");
  });
  it("CI pins upstream actions and gates frozen installs, architecture, tests, audit, and container smoke", () => {
    const ci = read(".github/workflows/ci.yml");
    // Tolerant of CRLF working-tree files (core.autocrlf) and 2- or 4-space
    // indentation, while still asserting the minimal permissions block.
    expect(ci).toMatch(/permissions:\s*\r?\n\s*contents:\s*read\b/);
    expect(ci).toMatch(/actions\/checkout@[a-f0-9]{40}/);
    expect(ci).toMatch(/actions\/setup-node@[a-f0-9]{40}/);
    expect(ci).toContain("ERR_PNPM_OUTDATED_LOCKFILE");
    for (const gate of ["pnpm install --frozen-lockfile", "pnpm run typecheck", "pnpm exec vitest run",
      "pnpm run test:coverage", "pnpm audit --prod", "docker build", "docker exec",
      "scripts/verify-g1-global.mjs", "scripts/verify-runtime-versions.mjs"]) expect(ci).toContain(gate);
  });
  it("manual startup and service watchdog validate Node/pnpm versions before execution", () => {
    const watchdog = read("scripts/hooshix_nodejs_mcp_watchdog.ps1");
    const start = read("scripts/start_nodejs_mcp.bat");
    expect(read(".nvmrc").trim()).toBe("24.18.0");
    expect(watchdog).toContain("Get-Command node");
    expect(watchdog).toContain("Get-Command pnpm");
    expect(watchdog).toContain("11.24.0");
    expect(watchdog).toContain("$psi.FileName = $script:NodeExecutable");
    expect(start).toContain("requires Node.js 24");
    expect(start).toContain("requires pnpm 11.24.0");
    expect(start).not.toContain("set MCP_PUBLIC_BASE_URL=https://");
  });
  it("old bootstrap credential names fail explicitly", () => {
    expect(() => readHttpBootstrapSecret({ MCP_API_KEY: "legacy" })).toThrow(/MCP_API_KEY/);
    expect(() => readHttpBootstrapSecret({ MCP_ACCESS_TOKEN: "legacy" })).toThrow(/MCP_ACCESS_TOKEN/);
    expect(() => readHttpSecurityConfig({ MCP_API_KEY: "legacy" })).toThrow(/MCP_API_KEY/);
  });
});
