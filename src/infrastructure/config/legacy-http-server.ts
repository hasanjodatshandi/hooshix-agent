/**
 * Compatibility settings for the existing HTTP server.
 * R1 only moves environment access; R5/R7 own validated auth/config cutover.
 * All legacy coercion/default and lazy-token semantics are preserved.
 */
export interface LegacyHttpServerSettings {
  readonly port: number;
  readonly publicBaseUrl: string;
}
export function readLegacyHttpServerSettings(
  env: Readonly<Record<string, string | undefined>> = process.env,
): LegacyHttpServerSettings {
  return {
    port: parseInt(env.MCP_PORT ?? "3001", 10),
    publicBaseUrl: (env.MCP_PUBLIC_BASE_URL ?? "").replace(/\/$/, ""),
  };
}
export function readLegacyHttpAccessToken(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  return env.MCP_ACCESS_TOKEN;
}
