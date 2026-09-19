/**
 * Legacy runtime path settings live at the infrastructure/config boundary.
 * Reads are deliberately lazy to preserve the existing test/bootstrap
 * contract: callers may set environment variables before each operation.
 * R7 owns validation and replacement with a typed immutable config loader.
 */
export interface LegacyRuntimePathSettings {
  readonly databasePath: string;
  readonly logDirectory: string;
}
export function readLegacyRuntimePaths(env: Readonly<Record<string, string | undefined>> = process.env): LegacyRuntimePathSettings {
  return {
    databasePath: env.HOOSHIX_DB_PATH ?? "./data/agent-memory.db",
    logDirectory: env.HOOSHIX_LOG_DIR ?? "./logs",
  };
}
