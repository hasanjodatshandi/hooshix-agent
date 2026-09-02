import { afterEach, describe, expect, it } from "vitest";
import { commandFor, managePackage, validatePackageName, verificationCommandFor } from "../src/services/package/package-service.js";

const original = process.env.HOOSHIX_PERMISSION_LEVEL;

afterEach(() => {
  if (original === undefined) delete process.env.HOOSHIX_PERMISSION_LEVEL;
  else process.env.HOOSHIX_PERMISSION_LEVEL = original;
});

describe("package service policy", () => {
  it("builds argument-array commands without a shell", () => {
    expect(commandFor("npm", "remove", "zod")).toEqual({ command: "npm", args: ["uninstall", "zod"] });
    expect(commandFor("pnpm", "install", "@scope/pkg")).toEqual({ command: "pnpm", args: ["add", "@scope/pkg"] });
    expect(commandFor("pip", "update", "requests")).toEqual({ command: "python", args: ["-m", "pip", "install", "--upgrade", "requests"] });
    expect(commandFor("winget", "install", "Vendor.App").args).toContain("--exact");
    expect(commandFor("choco", "remove", "git").args).toEqual(["uninstall", "git", "-y"]);
    expect(verificationCommandFor("npm", "zod")).toEqual({ command: "npm", args: ["list", "zod", "--depth=0", "--json"] });
    expect(verificationCommandFor("npm", "zod@4.5.4")).toEqual({ command: "npm", args: ["list", "zod", "--depth=0", "--json"] });
    expect(verificationCommandFor("pnpm", "@scope/pkg@2")).toEqual({ command: "pnpm", args: ["list", "@scope/pkg", "--depth=0", "--json"] });
    expect(verificationCommandFor("pip", "requests")).toEqual({ command: "python", args: ["-m", "pip", "show", "requests"] });
  });

  it("validates package identifiers before process execution", () => {
    expect(validatePackageName("@scope/package-name@1.2.3")).toBe("@scope/package-name@1.2.3");
    expect(() => validatePackageName("--global")).toThrow("Invalid package name");
    expect(() => validatePackageName("../escape")).toThrow("Invalid package name");
    expect(() => validatePackageName("pkg;whoami")).toThrow("Invalid package name");
  });

  it("enforces developer and admin permission boundaries before spawning", async () => {
    process.env.HOOSHIX_PERMISSION_LEVEL = "READ_ONLY";
    await expect(managePackage({ manager: "npm", action: "install", name: "zod" })).rejects.toThrow("DEVELOPER_MODE");
    process.env.HOOSHIX_PERMISSION_LEVEL = "DEVELOPER_MODE";
    await expect(managePackage({ manager: "winget", action: "install", name: "Vendor.App" })).rejects.toThrow("ADMIN_MODE");
  });
});
