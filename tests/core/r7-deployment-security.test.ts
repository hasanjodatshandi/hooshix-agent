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
  it("the service host probes unauthenticated liveness without injecting obsolete credential", () => {
    // The watchdog is gone; the supervisor inside the Windows service answers
    // for the same contract: an unauthenticated probe of the server's own health
    // routes, with no credential attached to the request at any point.
    const host = read("deploy/windows/internal/host/host.go");
    expect(host).toContain(`base+"/health/live"`);
    expect(host).toContain(`base+"/health/ready"`);
    expect(host).not.toContain("MCP_ACCESS_TOKEN");
    expect(host).not.toContain("Bearer");
    // The tray reads the document that probe publishes instead of dialling the
    // endpoint itself, so it holds nothing to leak.
    expect(read("deploy/windows/internal/tray/state.go")).not.toContain("net/http");
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
  it("the installer validates the pinned toolchain before anything is built or shipped", () => {
    // What the .bat and the watchdog did by hand — prove node and pnpm are the
    // pinned lines, then start an absolute interpreter — is now a build-time
    // gate plus an absolute path in the settings document.
    const installer = read("scripts/build-windows-installer.mjs");
    expect(installer).toContain("verify-runtime-versions.mjs");
    // The candidate runtime is asked for its version, not trusted by directory name.
    expect(installer).toContain('execFileSync(candidate, ["-v"]');
    expect(read("scripts/verify-runtime-versions.mjs")).toContain("packageManager must be pinned as pnpm@<exact>");
    expect(read(".nvmrc").trim()).toBe("24.18.0");
    expect(JSON.parse(read("package.json")).packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/);
    // The child is spawned by absolute path from the settings document: a service
    // session has no operator PATH to inherit.
    expect(read("deploy/windows/internal/host/settings.go")).toContain('Node string `json:"node"`');
    // The retired public-origin alias must not return through the new surfaces.
    expect(installer).not.toContain("MCP_PUBLIC_BASE_URL");
    expect(read("deploy/windows/internal/setup/layout.go")).not.toContain("MCP_PUBLIC_BASE_URL");
  });
  it("old bootstrap credential names fail explicitly", () => {
    expect(() => readHttpBootstrapSecret({ MCP_API_KEY: "legacy" })).toThrow(/MCP_API_KEY/);
    expect(() => readHttpBootstrapSecret({ MCP_ACCESS_TOKEN: "legacy" })).toThrow(/MCP_ACCESS_TOKEN/);
    expect(() => readHttpSecurityConfig({ MCP_API_KEY: "legacy" })).toThrow(/MCP_API_KEY/);
  });
});
