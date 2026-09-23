/**
 * R7.01 compatibility projection. The single authoritative parser lives in
 * `app-config.ts`; this module only re-exposes it under the historical names so
 * existing imports keep resolving. No parsing logic is duplicated.
 */
import {
  parseBootstrapSecret,
  parseHttpSecurityConfig,
  type HttpServerSettings,
} from "./app-config.js";

export type { HttpServerSettings };

export function readLegacyHttpServerSettings(
  env: Readonly<Record<string, string | undefined>> = process.env,
): { port: number; publicBaseUrl: string } {
  const c = parseHttpSecurityConfig(env);
  return { port: c.port, publicBaseUrl: c.publicBaseUrl };
}

/** Retired credential: a bearer token is never issued from the bootstrap secret. */
export function readLegacyHttpAccessToken(
  _env: Readonly<Record<string, string | undefined>> = process.env,
): undefined {
  return undefined;
}

export const readHttpBootstrapSecret = parseBootstrapSecret;
export const readHttpSecurityConfig = parseHttpSecurityConfig;
