import { describe, expect, it } from "vitest";
import { insertPackageSnapshot, updateStoredPackageSnapshot, findPackageSnapshot } from "../../src/adapters/outbound/persistence/sqlite/repositories/package-snapshot.adapter.js";

describe("R1 package snapshot SQLite boundary", () => {
  it("persists and reads a serialized manifest snapshot with legacy row compatibility", () => {
    insertPackageSnapshot({
      id: "r1-pkg-snapshot", correlationId: "r1-package-adapter", manager: "pnpm", action: "install",
      packageName: "example", cwd: "/fixture-only",
      snapshot: { files: [{ path: "package.json", existed: false }], environment: { manager: "pnpm" } },
    });
    const created = findPackageSnapshot("r1-pkg-snapshot");
    expect(created?.status).toBe("created");
    expect(created?.cwd).toBe("/fixture-only");
    expect(JSON.parse(created!.snapshot).files).toEqual([{ path: "package.json", existed: false }]);
    updateStoredPackageSnapshot("r1-pkg-snapshot", "committed");
    expect(findPackageSnapshot("r1-pkg-snapshot")?.status).toBe("committed");
    updateStoredPackageSnapshot("r1-pkg-snapshot", "rolled_back");
    expect(findPackageSnapshot("r1-pkg-snapshot")?.status).toBe("rolled_back");
    expect(findPackageSnapshot("r1-missing")).toBeUndefined();
  });
});
