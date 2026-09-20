import { getOperationDescriptor } from "./operation-catalog.js";
export type LegacyPermissionLevel = "READ_ONLY" | "PROJECT_ACCESS" | "DEVELOPER_MODE" | "ADMIN_MODE";
const rank: Readonly<Record<LegacyPermissionLevel, number>> = { READ_ONLY:0, PROJECT_ACCESS:1, DEVELOPER_MODE:2, ADMIN_MODE:3 };
const compatibleLevel = { READ:"READ_ONLY", PROJECT_ACCESS:"PROJECT_ACCESS", DEVELOPER:"DEVELOPER_MODE", ADMIN:"ADMIN_MODE" } as const;
export function assertLegacyToolPermission(tool: string, level: LegacyPermissionLevel): true {
  const descriptor = getOperationDescriptor(tool === "package_manage" ? "install_package" : tool);
  const required: LegacyPermissionLevel = descriptor ? compatibleLevel[descriptor.requiredPermission] : "ADMIN_MODE";
  if (rank[level] < rank[required]) {
    throw new Error(`${tool} requires ${required}; current level is ${level}`);
  }
  return true;
}

export function assertLegacyAdminPermission(level: LegacyPermissionLevel): true {
  if (rank[level] < rank.ADMIN_MODE) {
    throw new Error(`Operation requires ADMIN_MODE; current level is ${level}`);
  }
  return true;
}