/** R1 compatibility-only startup settings. R7 replaces with validated immutable configuration. */
export function readLegacyRetentionDays(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  return Number(env.HOOSHIX_RETENTION_DAYS ?? 90);
}
