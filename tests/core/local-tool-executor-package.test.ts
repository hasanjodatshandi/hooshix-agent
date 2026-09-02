import { describe, expect, it, vi } from "vitest";

const { managePackageMock } = vi.hoisted(() => ({ managePackageMock: vi.fn(async (input) => input) }));
vi.mock("../../src/services/package/package-service.js", () => ({ managePackage: managePackageMock }));

import { createLocalToolExecutor } from "../../src/core/executor/local-tool-executor.js";

describe("local package dispatch", () => {
  it("maps package tool names to typed actions", async () => {
    const execute = createLocalToolExecutor("package-dispatch", "package-task");
    const base = { id: 1, action: "package", status: "pending" as const, arguments: { manager: "npm", name: "zod" } };
    await execute("install_package", { ...base, tool: "install_package" });
    await execute("remove_package", { ...base, tool: "remove_package" });
    await execute("update_package", { ...base, tool: "update_package" });
    expect(managePackageMock.mock.calls.map(([input]) => input.action)).toEqual(["install", "remove", "update"]);
  });
});
