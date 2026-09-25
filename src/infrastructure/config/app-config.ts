import path from "node:path";
import type { LegacyPermissionLevel } from "../../application/services/legacy-permission-policy.js";

/**
 * R7.01 — the single authoritative, immutable application configuration contract.
 *
 * Every operational setting is parsed and validated here exactly once. No other
 * module may read `process.env` or re-parse these values; the legacy section
 * readers in this directory are documented compatibility projections of the
 * parsers below and must never duplicate parsing logic.
 */

export type RuntimeMode = "stdio" | "http";
export type Environment = "development" | "test" | "production";

export interface HttpServerSettings {
  readonly port: number;
  readonly host: string;
  readonly publicBaseUrl: string;
  readonly resource: string;
  readonly allowedOrigins: readonly string[];
}

export interface WorkspaceSettings {
  /** Comma-separated bootstrap root pool. The database remains authoritative. */
  readonly rootsCsv: string;
  /** Server-level opt-in ceiling only; never an automatic global grant. */
  readonly unrestrictedBootOptIn: boolean;
}

export interface OAuthSettings {
  readonly accessTtlMs: number;
  readonly refreshTtlMs: number;
  readonly codeTtlMs: number;
  readonly maxPendingCodes: number;
  readonly clientRegistrationLimit: number;
  readonly maxRedirectUris: number;
  readonly cleanupIntervalMs: number;
}

export interface RateLimitSettings {
  readonly publicRequestsPerWindow: number;
  readonly principalRequestsPerWindow: number;
  readonly operatorLoginAttemptsPerWindow: number;
  readonly windowMs: number;
  readonly maxLimiterKeys: number;
  readonly maxConcurrentRequestsPerPrincipal: number;
}

export interface SessionSettings {
  readonly idleMs: number;
  readonly absoluteMs: number;
  readonly graceMs: number;
  readonly maxMcpSessions: number;
  readonly operatorCap: number;
  readonly contextCap: number;
  readonly cleanupIntervalMs: number;
}

export interface LeaseSettings {
  readonly ttlMs: number;
  readonly heartbeatMs: number;
  readonly minTtlMs: number;
  readonly maxTtlMs: number;
}

export interface SearchSettings {
  readonly maxScannedFiles: number;
  readonly maxScannedBytes: number;
  readonly maxResults: number;
  readonly maxElapsedMs: number;
  readonly maxConcurrent: number;
}

export interface AppConfig {
  readonly runtime: RuntimeMode;
  readonly environment: Environment;
  readonly http: HttpServerSettings;
  readonly bootstrapToken: string | undefined;
  readonly bootstrapTokenFile: string;
  readonly databasePath: string;
  readonly logDirectory: string;
  readonly permissionLevel: LegacyPermissionLevel;
  readonly workspace: WorkspaceSettings;
  readonly directApprovalBypass: boolean;
  readonly retentionDays: number;
  readonly terminationGraceMs: number;
  readonly oauth: OAuthSettings;
  readonly rateLimit: RateLimitSettings;
  readonly session: SessionSettings;
  readonly lease: LeaseSettings;
  readonly search: SearchSettings;
}

/** Canonical name -> accepted deprecated alias. Both set with differing values is a migration error. */
const HTTP_ENV_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ["HOOSHIX_HTTP_PORT", "MCP_PORT"],
  ["HOOSHIX_HTTP_HOST", "MCP_BIND_HOST"],
  ["HOOSHIX_PUBLIC_BASE_URL", "MCP_PUBLIC_BASE_URL"],
  ["HOOSHIX_ALLOWED_ORIGINS", "MCP_ALLOWED_ORIGINS"],
];

const PERMISSION_LEVELS: ReadonlySet<LegacyPermissionLevel> = new Set([
  "READ_ONLY", "PROJECT_ACCESS", "DEVELOPER_MODE", "ADMIN_MODE",
]);

/**
 * R7.02 — a canonical name and its deprecated alias may not disagree. Failing
 * visibly here prevents a silent split-brain between the service, Docker,
 * watchdog and tests. Equal values are tolerated (the canonical name wins).
 */
function assertNoAliasConflict(env: Readonly<Record<string, string | undefined>> = process.env): void {
  for (const [canonical, alias] of HTTP_ENV_ALIASES) {
    const a = env[canonical];
    const b = env[alias];
    if (a === undefined || b === undefined) continue;
    if (a.trim() !== b.trim())
      throw new Error(
        `conflicting environment names: ${alias} and ${canonical} differ; keep only ${canonical}`,
      );
  }
}

/** Deprecated bootstrap credential names are hard migration errors, never silently honoured. */
export function parseBootstrapSecret(env: Readonly<Record<string, string | undefined>> = process.env): string | undefined {
  if (env.MCP_ACCESS_TOKEN !== undefined)
    throw new Error("MCP_ACCESS_TOKEN is deprecated and cannot be used as a client bearer; use HOOSHIX_BOOTSTRAP_TOKEN");
  if (env.MCP_API_KEY !== undefined)
    throw new Error("MCP_API_KEY is unsupported; migrate to HOOSHIX_BOOTSTRAP_TOKEN");
  return env.HOOSHIX_BOOTSTRAP_TOKEN || undefined;
}

export function parseHttpSecurityConfig(env: Readonly<Record<string, string | undefined>> = process.env): HttpServerSettings {
  if (env.MCP_ACCESS_TOKEN !== undefined || env.MCP_API_KEY !== undefined) parseBootstrapSecret(env);
  const port = Number(env.HOOSHIX_HTTP_PORT ?? env.MCP_PORT ?? "3001");
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error("invalid MCP_PORT");
  const host = env.HOOSHIX_HTTP_HOST ?? env.MCP_BIND_HOST ?? "127.0.0.1";
  const local = ["127.0.0.1", "localhost", "::1"].includes(host);
  const raw = (env.HOOSHIX_PUBLIC_BASE_URL ?? env.MCP_PUBLIC_BASE_URL)?.trim() ?? "";
  if (!local && !raw) throw new Error("MCP_PUBLIC_BASE_URL required for external HTTP binding");
  let publicBaseUrl = "";
  if (raw) {
    const parsed = new URL(raw);
    if (parsed.username || parsed.password || parsed.hash || parsed.search || parsed.pathname !== "/" ||
      (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) ||
      (!local && parsed.protocol !== "https:"))
      throw new Error("MCP_PUBLIC_BASE_URL must be an exact trusted HTTPS origin");
    publicBaseUrl = parsed.origin;
  } else {
    publicBaseUrl = `http://127.0.0.1:${port}`;
  }
  const allowedOrigins = (env.HOOSHIX_ALLOWED_ORIGINS ?? env.MCP_ALLOWED_ORIGINS ?? "")
    .split(",").map(s => s.trim()).filter(Boolean);
  for (const origin of allowedOrigins) {
    const url = new URL(origin);
    if (url.origin !== origin || url.username || url.password ||
      (url.protocol !== "https:" && !(local && url.protocol === "http:")))
      throw new Error("MCP_ALLOWED_ORIGINS requires explicit valid origins");
  }
  return Object.freeze({ port, host, publicBaseUrl, resource: publicBaseUrl + "/mcp", allowedOrigins });
}

export function parseDatabasePath(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return env.HOOSHIX_DB_PATH ?? "./data/agent-memory.db";
}

export function parseLogDirectory(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return env.HOOSHIX_LOG_DIR ?? "./logs";
}

/**
 * The environment handed to a shell-spawned subprocess. A command author is
 * untrusted code, so the child must never inherit this process's secrets —
 * not the bootstrap token, not the OAuth client secret, not the database and
 * log paths. This is an allowlist, not a denylist: a command gets only what it
 * needs to be found and to run (the executable search path plus the handful of
 * OS-level variables Node and the platform loader depend on). Everything else,
 * including every HOOSHIX_*, is withheld by omission.
 */
const ALLOWED_CHILD_ENV_KEYS = [
  "PATH",
  "PATHEXT",        // Windows executable-resolution suffixes
  "SystemRoot",     // Windows: where the system DLLs live
  "WINDIR",
  "COMSPEC",        // Windows default command interpreter
  "PSModulePath",   // PowerShell module discovery
  "LANG",
  "LC_ALL",
  "TZ",
  "HOME",
  "USERPROFILE",
  "TEMP",
  "TMP",
] as const;

export function buildChildProcessEnvironment(env: Readonly<Record<string, string | undefined>> = process.env): Record<string, string> {
  const childEnv: Record<string, string> = {};
  for (const key of ALLOWED_CHILD_ENV_KEYS) {
    const value = env[key];
    if (value !== undefined && value !== "") childEnv[key] = value;
  }
  return childEnv;
}

export function parsePermissionLevel(env: Readonly<Record<string, string | undefined>> = process.env): LegacyPermissionLevel {
  // Fail-safe default: with no explicit configuration the server grants the
  // least authority. DEVELOPER_MODE lets a client run arbitrary shell and
  // package installs, which must be a deliberate operator decision, never an
  // accidental default of an unconfigured deployment.
  const configured = env.HOOSHIX_PERMISSION_LEVEL ?? "READ_ONLY";
  if (!PERMISSION_LEVELS.has(configured as LegacyPermissionLevel))
    throw new Error(`Invalid HOOSHIX_PERMISSION_LEVEL: ${configured}`);
  return configured as LegacyPermissionLevel;
}

export function parseWorkspaceSettings(env: Readonly<Record<string, string | undefined>> = process.env): WorkspaceSettings {
  return Object.freeze({
    rootsCsv: env.HOOSHIX_WORKSPACE?.trim() ?? "",
    unrestrictedBootOptIn: env.HOOSHIX_UNRESTRICTED === "1" || env.HOOSHIX_UNRESTRICTED === "true",
  });
}

export function parseDirectApprovalBypass(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.HOOSHIX_DIRECT_AUTO_APPROVE === "1";
}

/** Raw retention parse kept lenient for the compatibility reader; the typed contract validates. */
export function parseRetentionDaysRaw(env: Readonly<Record<string, string | undefined>> = process.env): number {
  return Number(env.HOOSHIX_RETENTION_DAYS ?? 90);
}

export function parseTerminationGraceMs(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const raw = env.HOOSHIX_TERMINATION_GRACE_MS;
  if (raw === undefined) return 5000;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 10 || value > 30000)
    throw new Error("HOOSHIX_TERMINATION_GRACE_MS must be an integer from 10 through 30000");
  return value;
}

/** Returns a validated positive integer, or `fallback` when the name is absent. */
function positiveInt(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
  min = 1,
): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min)
    throw new Error(`${name} must be an integer of at least ${min}`);
  return value;
}

export function parseOAuthSettings(env: Readonly<Record<string, string | undefined>> = process.env): OAuthSettings {
  const accessTtlMs = positiveInt(env, "HOOSHIX_OAUTH_ACCESS_TTL_MS", 3_600_000, 1000);
  const refreshTtlMs = positiveInt(env, "HOOSHIX_OAUTH_REFRESH_TTL_MS", 30 * 24 * 3_600_000, 1000);
  const codeTtlMs = positiveInt(env, "HOOSHIX_OAUTH_CODE_TTL_MS", 300_000, 1000);
  const maxPendingCodes = positiveInt(env, "HOOSHIX_OAUTH_MAX_PENDING_CODES", 128);
  const clientRegistrationLimit = positiveInt(env, "HOOSHIX_OAUTH_CLIENT_LIMIT", 256);
  const maxRedirectUris = positiveInt(env, "HOOSHIX_OAUTH_MAX_REDIRECT_URIS", 8);
  const cleanupIntervalMs = positiveInt(env, "HOOSHIX_OAUTH_CLEANUP_INTERVAL_MS", 60_000, 1000);
  if (accessTtlMs >= refreshTtlMs)
    throw new Error("HOOSHIX_OAUTH_ACCESS_TTL_MS must be shorter than HOOSHIX_OAUTH_REFRESH_TTL_MS");
  if (codeTtlMs >= accessTtlMs)
    throw new Error("HOOSHIX_OAUTH_CODE_TTL_MS must be shorter than HOOSHIX_OAUTH_ACCESS_TTL_MS");
  return Object.freeze({
    accessTtlMs, refreshTtlMs, codeTtlMs, maxPendingCodes,
    clientRegistrationLimit, maxRedirectUris, cleanupIntervalMs,
  });
}

export function parseRateLimitSettings(env: Readonly<Record<string, string | undefined>> = process.env): RateLimitSettings {
  const windowMs = positiveInt(env, "HOOSHIX_RATE_LIMIT_WINDOW_MS", 60_000, 1000);
  return Object.freeze({
    publicRequestsPerWindow: positiveInt(env, "HOOSHIX_PUBLIC_RATE_LIMIT", 60),
    principalRequestsPerWindow: positiveInt(env, "HOOSHIX_PRINCIPAL_RATE_LIMIT", 120),
    operatorLoginAttemptsPerWindow: positiveInt(env, "HOOSHIX_OPERATOR_LOGIN_RATE_LIMIT", 5),
    windowMs,
    maxLimiterKeys: positiveInt(env, "HOOSHIX_RATE_LIMIT_MAX_KEYS", 4096),
    maxConcurrentRequestsPerPrincipal: positiveInt(env, "HOOSHIX_MAX_CONCURRENT_REQUESTS", 8),
  });
}

export function parseSessionSettings(env: Readonly<Record<string, string | undefined>> = process.env): SessionSettings {
  const idleMs = positiveInt(env, "HOOSHIX_SESSION_IDLE_MS", 30 * 60_000, 1000);
  const absoluteMs = positiveInt(env, "HOOSHIX_SESSION_ABSOLUTE_MS", 8 * 60 * 60_000, 1000);
  const graceMs = positiveInt(env, "HOOSHIX_SESSION_GRACE_MS", 5 * 60_000, 1000);
  const maxMcpSessions = positiveInt(env, "HOOSHIX_MAX_MCP_SESSIONS", 64);
  const operatorCap = positiveInt(env, "HOOSHIX_OPERATOR_SESSION_LIMIT", 64);
  const contextCap = positiveInt(env, "HOOSHIX_MODERN_CONTEXT_LIMIT", 64);
  const cleanupIntervalMs = positiveInt(env, "HOOSHIX_SESSION_CLEANUP_INTERVAL_MS", 60_000, 1000);
  if (idleMs >= absoluteMs)
    throw new Error("HOOSHIX_SESSION_IDLE_MS must be shorter than HOOSHIX_SESSION_ABSOLUTE_MS");
  if (graceMs >= idleMs)
    throw new Error("HOOSHIX_SESSION_GRACE_MS must be shorter than HOOSHIX_SESSION_IDLE_MS");
  return Object.freeze({
    idleMs, absoluteMs, graceMs, maxMcpSessions, operatorCap, contextCap, cleanupIntervalMs,
  });
}

export function parseLeaseSettings(env: Readonly<Record<string, string | undefined>> = process.env): LeaseSettings {
  const minTtlMs = positiveInt(env, "HOOSHIX_TASK_LEASE_MIN_TTL_MS", 100, 1);
  const maxTtlMs = positiveInt(env, "HOOSHIX_TASK_LEASE_MAX_TTL_MS", 120_000, 1000);
  const ttlMs = positiveInt(env, "HOOSHIX_TASK_LEASE_TTL_MS", 30_000, 1);
  const heartbeatMs = positiveInt(env, "HOOSHIX_TASK_LEASE_HEARTBEAT_MS", 5_000, 10);
  if (minTtlMs >= maxTtlMs)
    throw new Error("HOOSHIX_TASK_LEASE_MIN_TTL_MS must be shorter than HOOSHIX_TASK_LEASE_MAX_TTL_MS");
  if (ttlMs < minTtlMs || ttlMs > maxTtlMs)
    throw new Error(`HOOSHIX_TASK_LEASE_TTL_MS must be between ${minTtlMs} and ${maxTtlMs}`);
  if (heartbeatMs >= ttlMs / 2)
    throw new Error("HOOSHIX_TASK_LEASE_HEARTBEAT_MS must be shorter than half the lease TTL");
  return Object.freeze({ ttlMs, heartbeatMs, minTtlMs, maxTtlMs });
}

export function parseSearchSettings(env: Readonly<Record<string, string | undefined>> = process.env): SearchSettings {
  return Object.freeze({
    maxScannedFiles: positiveInt(env, "HOOSHIX_SEARCH_MAX_SCANNED_FILES", 10_000),
    maxScannedBytes: positiveInt(env, "HOOSHIX_SEARCH_MAX_SCANNED_BYTES", 16 * 1024 * 1024),
    maxResults: positiveInt(env, "HOOSHIX_SEARCH_MAX_RESULTS", 1_000),
    maxElapsedMs: positiveInt(env, "HOOSHIX_SEARCH_MAX_ELAPSED_MS", 10_000, 1000),
    maxConcurrent: positiveInt(env, "HOOSHIX_SEARCH_MAX_CONCURRENT", 4),
  });
}

function environmentOf(env: Readonly<Record<string, string | undefined>> = process.env): Environment {
  const value = env.HOOSHIX_ENV ?? env.NODE_ENV ?? "development";
  if (value !== "development" && value !== "test" && value !== "production")
    throw new Error("invalid HOOSHIX_ENV");
  return value;
}

function runtimeOf(env: Readonly<Record<string, string | undefined>>, runtime: RuntimeMode | undefined): RuntimeMode {
  const value = runtime ?? env.HOOSHIX_RUNTIME ?? "stdio";
  if (value !== "stdio" && value !== "http")
    throw new Error("invalid HOOSHIX_RUNTIME: expected stdio or http");
  return value;
}

/**
 * The single loader. `runtime` is supplied by the chosen entrypoint and is the
 * only setting that is not an environment variable; it is still validated here.
 */
export function loadAppConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
  cwd = process.cwd(),
  runtime?: RuntimeMode,
): AppConfig {
  assertNoAliasConflict(env);
  const retentionDays = parseRetentionDaysRaw(env);
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 0 || retentionDays > 36500)
    throw new Error("HOOSHIX_RETENTION_DAYS must be an integer from 0 through 36500");
  const config: AppConfig = {
    runtime: runtimeOf(env, runtime),
    environment: environmentOf(env),
    http: parseHttpSecurityConfig(env),
    bootstrapToken: parseBootstrapSecret(env),
    bootstrapTokenFile: env.HOOSHIX_BOOTSTRAP_TOKEN_FILE?.trim() || path.join(cwd, ".token"),
    databasePath: parseDatabasePath(env),
    logDirectory: parseLogDirectory(env),
    permissionLevel: parsePermissionLevel(env),
    workspace: parseWorkspaceSettings(env),
    directApprovalBypass: parseDirectApprovalBypass(env),
    retentionDays,
    terminationGraceMs: parseTerminationGraceMs(env),
    oauth: parseOAuthSettings(env),
    rateLimit: parseRateLimitSettings(env),
    session: parseSessionSettings(env),
    lease: parseLeaseSettings(env),
    search: parseSearchSettings(env),
  };
  return Object.freeze(config);
}
