import { describe, expect, it, vi } from "vitest";

const { managePackageMock } = vi.hoisted(() => ({ managePackageMock: vi.fn(async (input) => input) }));
vi.mock("../../src/services/package/package-service.js", () => ({
  managePackage: managePackageMock,
  PACKAGE_MANAGERS: ["npm", "pnpm", "yarn", "bun", "pip", "uv", "poetry", "cargo", "dotnet", "composer", "bundler", "gem", "go", "maven", "gradle", "winget", "choco", "brew", "apt", "dnf", "pacman", "zypper"] as const,
}));

import { createLocalToolExecutor } from "../../src/core/executor/local-tool-executor.js";

describe("local package dispatch", () => {
  it("never dispatches package mutations from a standalone executor without an exact persisted approval", async () => {
    const execute = createLocalToolExecutor("package-dispatch", "package-task");
    const base = { id: 1, action: "package", status: "pending" as const, arguments: { manager: "npm", name: "zod" } };
    for (const tool of ["install_package", "remove_package", "update_package"] as const) {
      await expect(execute(tool, { ...base, tool })).rejects.toThrow(/Approval required/);
    }
    expect(managePackageMock).not.toHaveBeenCalled();
  });
});