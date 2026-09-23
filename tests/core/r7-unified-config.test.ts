import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  loadAppConfig,
  parseHttpSecurityConfig,
  type AppConfig,
} from "../../src/infrastructure/config/app-config.js";
import { readLegacyRuntimePaths } from "../../src/infrastructure/config/legacy-runtime-paths.js";
import { readLegacyWorkspaceBootstrapSettings } from "../../src/infrastructure/config/legacy-workspace-bootstrap.js";
import { getConfiguredPermissionLevel } from "../../src/infrastructure/config/permission-config.js";
import { readLegacyRetentionDays } from "../../src/infrastructure/config/legacy-retention.js";

const NO_OPTS = {} as Readonly<Record<string, string | undefined>>;

describe("R7.01 unified immutable config — defaults", () => {
  it("reproduces every previously hardcoded operational default", () => {
    const cfg = loadAppConfig(NO_OPTS, "/cwd");
    expect(cfg.runtime).toBe("stdio");
    expect(cfg.environment).toBe("development");
    expect(cfg.http).toEqual({
      port: 3001, host: "127.0.0.1", publicBaseUrl: "http://127.0.0.1:3001",
      resource: "http://127.0.0.1:3001/mcp", allowedOrigins: [],
    });
    expect(cfg.bootstrapTokenFile).toBe(path.join("/cwd", ".token"));
    expect(cfg.databasePath).toBe("./data/agent-memory.db");
    expect(cfg.logDirectory).toBe("./logs");
    expect(cfg.permissionLevel).toBe("DEVELOPER_MODE");
    expect(cfg.workspace).toEqual({ rootsCsv: "", unrestrictedBootOptIn: false });
    expect(cfg.directApprovalBypass).toBe(false);
    expect(cfg.retentionDays).toBe(90);
    expect(cfg.terminationGraceMs).toBe(5000);
    expect(cfg.oauth).toEqual({
      accessTtlMs: 3_600_000, refreshTtlMs: 30 * 24 * 3_600_000, codeTtlMs: 300_000,
      maxPendingCodes: 128, clientRegistrationLimit: 256, maxRedirectUris: 8,
      cleanupIntervalMs: 60_000,
    });
    expect(cfg.rateLimit).toEqual({
      publicRequestsPerWindow: 60, principalRequestsPerWindow: 120,
      operatorLoginAttemptsPerWindow: 5, windowMs: 60_000, maxLimiterKeys: 4096,
      maxConcurrentRequestsPerPrincipal: 8,
    });
    expect(cfg.session).toEqual({
      idleMs: 30 * 60_000, absoluteMs: 8 * 60 * 60_000, graceMs: 5 * 60_000,
      maxMcpSessions: 64, operatorCap: 64, contextCap: 64, cleanupIntervalMs: 60_000,
    });
    expect(cfg.lease).toEqual({ ttlMs: 30_000, heartbeatMs: 5_000, minTtlMs: 100, maxTtlMs: 120_000 });
    expect(cfg.search).toEqual({
      maxScannedFiles: 10_000, maxScannedBytes: 16 * 1024 * 1024, maxResults: 1_000,
      maxElapsedMs: 10_000, maxConcurrent: 4,
    });
  });
});

describe("R7.01 unified immutable config — immutability", () => {
  it("freezes the contract and every nested section", () => {
    const cfg = loadAppConfig(NO_OPTS);
    expect(Object.isFrozen(cfg)).toBe(true);
    for (const section of [cfg.http, cfg.workspace, cfg.oauth, cfg.rateLimit,
      cfg.session, cfg.lease, cfg.search] as const)
      expect(Object.isFrozen(section)).toBe(true);
  });
});

describe("R7.01 unified immutable config — invalid values fail visibly", () => {
  const cases: ReadonlyArray<readonly [string, Readonly<Record<string, string>>, RegExp]> = [
    ["invalid HTTP port", { HOOSHIX_HTTP_PORT: "nope" }, /invalid MCP_PORT/],
    ["negative HTTP port", { HOOSHIX_HTTP_PORT: "-1" }, /invalid MCP_PORT/],
    ["invalid permission level", { HOOSHIX_PERMISSION_LEVEL: "ROOT" }, /Invalid HOOSHIX_PERMISSION_LEVEL/],
    ["invalid environment", { HOOSHIX_ENV: "staging" }, /invalid HOOSHIX_ENV/],
    ["invalid runtime", { HOOSHIX_RUNTIME: "ws" }, /invalid HOOSHIX_RUNTIME/],
    ["non-integer retention", { HOOSHIX_RETENTION_DAYS: "soon" }, /HOOSHIX_RETENTION_DAYS/],
    ["negative retention", { HOOSHIX_RETENTION_DAYS: "-5" }, /HOOSHIX_RETENTION_DAYS/],
    ["out-of-range grace", { HOOSHIX_TERMINATION_GRACE_MS: "1" }, /TERMINATION_GRACE_MS/],
    ["non-integer OAuth access TTL", { HOOSHIX_OAUTH_ACCESS_TTL_MS: "hour" }, /HOOSHIX_OAUTH_ACCESS_TTL_MS/],
    ["zero public rate limit", { HOOSHIX_PUBLIC_RATE_LIMIT: "0" }, /HOOSHIX_PUBLIC_RATE_LIMIT/],
    ["zero max sessions", { HOOSHIX_MAX_MCP_SESSIONS: "0" }, /HOOSHIX_MAX_MCP_SESSIONS/],
    ["zero search concurrency", { HOOSHIX_SEARCH_MAX_CONCURRENT: "0" }, /HOOSHIX_SEARCH_MAX_CONCURRENT/],
    ["lease heartbeat not under half TTL",
      { HOOSHIX_TASK_LEASE_HEARTBEAT_MS: "20000" }, /HEARTBEAT_MS must be shorter than half/],
    ["lease TTL outside bounds",
      { HOOSHIX_TASK_LEASE_TTL_MS: "999999" }, /HOOSHIX_TASK_LEASE_TTL_MS must be between/],
  ];
  for (const [name, env, pattern] of cases)
    it(`rejects ${name}`, () => {
      expect(() => loadAppConfig(env)).toThrow(pattern);
    });
});

describe("R7.01 unified immutable config — contradictory values fail visibly", () => {
  it("rejects an OAuth access TTL longer than the refresh TTL", () => {
    expect(() => loadAppConfig({ HOOSHIX_OAUTH_ACCESS_TTL_MS: "3600000", HOOSHIX_OAUTH_REFRESH_TTL_MS: "60000" }))
      .toThrow(/must be shorter than HOOSHIX_OAUTH_REFRESH_TTL_MS/);
  });
  it("rejects an OAuth code TTL longer than the access TTL", () => {
    expect(() => loadAppConfig({ HOOSHIX_OAUTH_CODE_TTL_MS: "3600000" }))
      .toThrow(/must be shorter than HOOSHIX_OAUTH_ACCESS_TTL_MS/);
  });
  it("rejects a session idle TTL longer than the absolute TTL", () => {
    expect(() => loadAppConfig({ HOOSHIX_SESSION_IDLE_MS: "3600000", HOOSHIX_SESSION_ABSOLUTE_MS: "60000" }))
      .toThrow(/must be shorter than HOOSHIX_SESSION_ABSOLUTE_MS/);
  });
  it("rejects a session grace TTL longer than the idle TTL", () => {
    expect(() => loadAppConfig({ HOOSHIX_SESSION_GRACE_MS: "3600000" }))
      .toThrow(/must be shorter than HOOSHIX_SESSION_IDLE_MS/);
  });
  it("rejects a lease min TTL not shorter than the max TTL", () => {
    expect(() => loadAppConfig({ HOOSHIX_TASK_LEASE_MIN_TTL_MS: "120000" }))
      .toThrow(/must be shorter than HOOSHIX_TASK_LEASE_MAX_TTL_MS/);
  });
});

describe("R7.01 unified immutable config — incomplete security settings fail", () => {
  it("requires a trusted HTTPS public base URL for an external bind", () => {
    expect(() => loadAppConfig({ HOOSHIX_HTTP_HOST: "0.0.0.0" })).toThrow(/MCP_PUBLIC_BASE_URL required/);
  });
  it("rejects a plain-HTTP public base URL for an external bind", () => {
    expect(() => loadAppConfig({ HOOSHIX_HTTP_HOST: "0.0.0.0", HOOSHIX_PUBLIC_BASE_URL: "http://example.invalid" }))
      .toThrow(/trusted HTTPS origin/);
  });
  it("rejects a public base URL carrying credentials or a path", () => {
    expect(() => loadAppConfig({ HOOSHIX_PUBLIC_BASE_URL: "https://user@example.invalid/" }))
      .toThrow(/trusted HTTPS origin/);
    expect(() => loadAppConfig({ HOOSHIX_PUBLIC_BASE_URL: "https://example.invalid/path" }))
      .toThrow(/trusted HTTPS origin/);
  });
  it("allows a loopback HTTP public base URL", () => {
    const cfg = loadAppConfig({ HOOSHIX_PUBLIC_BASE_URL: "http://127.0.0.1:3001" });
    expect(cfg.http.publicBaseUrl).toBe("http://127.0.0.1:3001");
  });
  it("rejects malformed allowed origins", () => {
    expect(() => loadAppConfig({ HOOSHIX_ALLOWED_ORIGINS: "https://example.invalid/path" }))
      .toThrow(/MCP_ALLOWED_ORIGINS/);
  });
  it("still rejects retired bootstrap credential names", () => {
    expect(() => loadAppConfig({ MCP_API_KEY: "legacy" })).toThrow(/MCP_API_KEY is unsupported/);
    expect(() => loadAppConfig({ MCP_ACCESS_TOKEN: "legacy" })).toThrow(/MCP_ACCESS_TOKEN is deprecated/);
  });
});

describe("R7.02 — canonical and deprecated HTTP env names", () => {
  it("fails when a canonical name and its alias disagree", () => {
    expect(() => loadAppConfig({ HOOSHIX_HTTP_PORT: "3001", MCP_PORT: "3002" }))
      .toThrow(/conflicting environment names: MCP_PORT and HOOSHIX_HTTP_PORT differ/);
    expect(() => loadAppConfig({ HOOSHIX_PUBLIC_BASE_URL: "https://a.invalid", MCP_PUBLIC_BASE_URL: "https://b.invalid" }))
      .toThrow(/conflicting environment names/);
  });
  it("accepts equal canonical and alias values without error", () => {
    const cfg = loadAppConfig({ HOOSHIX_HTTP_PORT: "3002", MCP_PORT: "3002" });
    expect(cfg.http.port).toBe(3002);
  });
  it("keeps honoring aliases when only the alias is set", () => {
    expect(parseHttpSecurityConfig({ MCP_PORT: "0", MCP_BIND_HOST: "127.0.0.1" }).port).toBe(0);
  });
  it("produces HTTP settings identical for stdio and http runtime modes", () => {
    const base = { HOOSHIX_PUBLIC_BASE_URL: "https://edge.invalid" };
    const stdio = loadAppConfig(base, "/cwd", "stdio");
    const http = loadAppConfig(base, "/cwd", "http");
    expect(stdio.http).toEqual(http.http);
    expect(stdio.runtime).toBe("stdio");
    expect(http.runtime).toBe("http");
  });
});

describe("R7.01 unified immutable config — single source of truth", () => {
  it("compatibility readers project exactly the same parsed values", () => {
    const env = {
      HOOSHIX_DB_PATH: "fixture/db.sqlite", HOOSHIX_LOG_DIR: "fixture/logs",
      HOOSHIX_WORKSPACE: "/fixture/root", HOOSHIX_UNRESTRICTED: "1",
      HOOSHIX_PERMISSION_LEVEL: "READ_ONLY", HOOSHIX_RETENTION_DAYS: "7",
    };
    const cfg: AppConfig = loadAppConfig(env);
    expect(readLegacyRuntimePaths(env)).toEqual({
      databasePath: cfg.databasePath, logDirectory: cfg.logDirectory,
    });
    expect(readLegacyWorkspaceBootstrapSettings(env)).toEqual(cfg.workspace);
    expect(getConfiguredPermissionLevel(env)).toBe(cfg.permissionLevel);
    // The compatibility retention reader stays deliberately lenient.
    expect(readLegacyRetentionDays(env)).toBe(7);
    expect(readLegacyRetentionDays({ HOOSHIX_RETENTION_DAYS: "invalid" })).toBeNaN();
    expect(readLegacyRetentionDays({ HOOSHIX_RETENTION_DAYS: "0" })).toBe(0);
  });
  it("treats retention 0 as explicitly disabled rather than invalid", () => {
    expect(loadAppConfig({ HOOSHIX_RETENTION_DAYS: "0" }).retentionDays).toBe(0);
  });
  it("applies overridden operational settings end to end", () => {
    const cfg = loadAppConfig({
      HOOSHIX_OAUTH_ACCESS_TTL_MS: "900000", HOOSHIX_SESSION_MAX: "not-used" as string,
      HOOSHIX_MAX_MCP_SESSIONS: "10", HOOSHIX_SEARCH_MAX_RESULTS: "5",
      HOOSHIX_TASK_LEASE_TTL_MS: "60000", HOOSHIX_TASK_LEASE_HEARTBEAT_MS: "1000",
    });
    expect(cfg.oauth.accessTtlMs).toBe(900000);
    expect(cfg.session.maxMcpSessions).toBe(10);
    expect(cfg.search.maxResults).toBe(5);
    expect(cfg.lease.ttlMs).toBe(60000);
    expect(cfg.lease.heartbeatMs).toBe(1000);
  });
});
