/**
 * Compatibility-only bootstrap settings for the legacy global WorkspaceGuard.
 * This does not authorize new roots or unrestricted mode: it reads the same
 * existing values, at the same lazy-init point. R2 owns principal-bound
 * authorization and removal of implicit global trust.
 */
export interface LegacyWorkspaceBootstrapSettings {
  readonly rootsCsv: string;
  readonly unrestrictedBootOptIn: boolean;
}
export function readLegacyWorkspaceBootstrapSettings(
  env: Readonly<Record<string, string | undefined>> = process.env,
): LegacyWorkspaceBootstrapSettings {
  return {
    rootsCsv: env.HOOSHIX_WORKSPACE?.trim() ?? "",
    unrestrictedBootOptIn: env.HOOSHIX_UNRESTRICTED === "1" || env.HOOSHIX_UNRESTRICTED === "true",
  };
}
