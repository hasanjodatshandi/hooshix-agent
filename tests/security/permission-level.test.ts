import { afterEach, describe, expect, it } from "vitest";
import { assertAdminPermission, assertToolPermission, getPermissionLevel } from "../../src/security/permission.js";

const original = process.env.HOOSHIX_PERMISSION_LEVEL;

afterEach(() => {
  if (original === undefined) delete process.env.HOOSHIX_PERMISSION_LEVEL;
  else process.env.HOOSHIX_PERMISSION_LEVEL = original;
});

describe("permission levels", () => {
  it("allows read-only tools and blocks mutations in READ_ONLY", () => {
    process.env.HOOSHIX_PERMISSION_LEVEL = "READ_ONLY";
    expect(assertToolPermission("read_file")).toBe(true);
    expect(() => assertToolPermission("write_file")).toThrow("requires PROJECT_ACCESS");
    expect(() => assertToolPermission("execute_command")).toThrow("requires DEVELOPER_MODE");
  });

  it("requires admin mode for operating-system package managers", () => {
    expect(() => assertAdminPermission("DEVELOPER_MODE")).toThrow("ADMIN_MODE");
    expect(assertAdminPermission("ADMIN_MODE")).toBe(true);
  });

  it("rejects an invalid environment value", () => {
    process.env.HOOSHIX_PERMISSION_LEVEL = "ROOT";
    expect(() => getPermissionLevel()).toThrow("Invalid HOOSHIX_PERMISSION_LEVEL");
  });
});
