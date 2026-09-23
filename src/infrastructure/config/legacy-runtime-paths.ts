/**
 * R7.01 compatibility projection over the single runtime-path parser in
 * `app-config.ts`. Reads stay lazy to preserve the existing bootstrap contract.
 */
import { parseDatabasePath, parseLogDirectory } from "./app-config.js";

export interface LegacyRuntimePathSettings {
  readonly databasePath: string;
  readonly logDirectory: string;
}

export function readLegacyRuntimePaths(
  env: Readonly<Record<string, string | undefined>> = process.env,
): LegacyRuntimePathSettings {
  return { databasePath: parseDatabasePath(env), logDirectory: parseLogDirectory(env) };
}
