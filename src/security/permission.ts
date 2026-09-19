/** R1 compatibility facade; config access is infrastructure-owned. */
import {
  assertLegacyAdminPermission,
  assertLegacyToolPermission,
  type LegacyPermissionLevel,
} from "../application/services/legacy-permission-policy.js";
import { getConfiguredPermissionLevel } from "../infrastructure/config/permission-config.js";

export type PermissionLevel = LegacyPermissionLevel;

export function getPermissionLevel(): PermissionLevel {
  return getConfiguredPermissionLevel();
}

export function assertToolPermission(tool: string, level = getPermissionLevel()): true {
  return assertLegacyToolPermission(tool, level);
}

export function assertAdminPermission(level = getPermissionLevel()): true {
  return assertLegacyAdminPermission(level);
}
