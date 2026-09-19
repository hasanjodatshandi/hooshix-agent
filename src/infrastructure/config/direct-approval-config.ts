/**
 * Compatibility-only direct approval bypass reader.
 * Production removal/replacement is governed by R2/R7 security work.
 */
export function isDirectApprovalBypassConfigured(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.HOOSHIX_DIRECT_AUTO_APPROVE === "1";
}
