import type { LegacyPermissionLevel } from "../../application/services/legacy-permission-policy.js";

const allowed = new Set<LegacyPermissionLevel>([
  "READ_ONLY", "PROJECT_ACCESS", "DEVELOPER_MODE", "ADMIN_MODE",
]);

/** The only compatibility reader for HOOSHIX_PERMISSION_LEVEL during migration. */
export function getConfiguredPermissionLevel(
  env: Readonly<Record<string, string | undefined>> = process.env,
): LegacyPermissionLevel {
  const configured = env.HOOSHIX_PERMISSION_LEVEL ?? "DEVELOPER_MODE";
  if (!allowed.has(configured as LegacyPermissionLevel)) {
    throw new Error(`Invalid HOOSHIX_PERMISSION_LEVEL: ${configured}`);
  }
  return configured as LegacyPermissionLevel;
}
