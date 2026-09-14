import { afterEach, describe, expect, it } from "vitest";
import { commandFor, managePackage, validatePackageName, verificationCommandFor } from "../src/services/package/package-service.js";
import { runWithPolicyApproval } from "../src/core/governance/policy-decision-point.js";

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

  it("supports all 22 managers across the three actions where a CLI form exists", () => {
    // JS ecosystem
    expect(commandFor("yarn", "install", "lodash")).toEqual({ command: "yarn", args: ["add", "lodash"] });
    expect(commandFor("yarn", "update", "lodash").args[0]).toBe("upgrade");
    expect(commandFor("bun", "install", "zod")).toEqual({ command: "bun", args: ["add", "zod"] });
    expect(commandFor("bun", "remove", "zod")).toEqual({ command: "bun", args: ["remove", "zod"] });
    // Python ecosystem
    expect(commandFor("uv", "install", "requests")).toEqual({ command: "uv", args: ["pip", "install", "requests"] });
    expect(commandFor("uv", "remove", "requests")).toEqual({ command: "uv", args: ["pip", "uninstall", "requests"] });
    expect(commandFor("poetry", "install", "requests")).toEqual({ command: "poetry", args: ["add", "requests"] });
    expect(commandFor("poetry", "update", "requests")).toEqual({ command: "poetry", args: ["update", "requests"] });
    // Rust / .NET / PHP / Ruby
    expect(commandFor("cargo", "install", "ripgrep")).toEqual({ command: "cargo", args: ["install", "ripgrep"] });
    expect(commandFor("cargo", "update", "ripgrep").args).toEqual(["install", "--force", "ripgrep"]);
    expect(commandFor("dotnet", "install", "Serilog")).toEqual({ command: "dotnet", args: ["add", "package", "Serilog"] });
    expect(commandFor("dotnet", "remove", "Serilog")).toEqual({ command: "dotnet", args: ["remove", "package", "Serilog"] });
    expect(commandFor("composer", "install", "monolog/monolog")).toEqual({ command: "composer", args: ["require", "monolog/monolog"] });
    expect(commandFor("bundler", "install", "rspec")).toEqual({ command: "bundle", args: ["add", "rspec"] });
    expect(commandFor("gem", "install", "rake")).toEqual({ command: "gem", args: ["install", "rake"] });
    // Go / JVM
    expect(commandFor("go", "install", "golang.org/x/tools").args).toEqual(["install", "golang.org/x/tools@latest"]);
    expect(commandFor("maven", "install", "com.google:guava:33.0.0").command).toBe("mvn");
    // System managers (ADMIN_MODE enforced at managePackage level)
    expect(commandFor("brew", "install", "wget")).toEqual({ command: "brew", args: ["install", "wget"] });
    expect(commandFor("apt", "install", "curl")).toEqual({ command: "apt-get", args: ["install", "-y", "curl"] });
    expect(commandFor("dnf", "update", "curl").args[0]).toBe("upgrade");
    expect(commandFor("pacman", "remove", "htop")).toEqual({ command: "pacman", args: ["-R", "--noconfirm", "htop"] });
    expect(commandFor("zypper", "install", "jq").args).toEqual(["--non-interactive", "install", "jq"]);
  });

  it("rejects manager/action pairs without a CLI form instead of guessing", () => {
    expect(() => commandFor("go", "remove", "golang.org/x/tools")).toThrow(/does not support "remove"/);
    expect(() => commandFor("gradle", "install", "com.google:guava")).toThrow(/does not support "install"/);
  });

  it("provides verification commands for all managers that have one", () => {
    expect(verificationCommandFor("yarn", "lodash")?.command).toBe("yarn");
    expect(verificationCommandFor("bun", "zod")?.args).toEqual(["pm", "ls"]);
    expect(verificationCommandFor("uv", "requests")?.command).toBe("uv");
    expect(verificationCommandFor("poetry", "requests")?.command).toBe("poetry");
    expect(verificationCommandFor("cargo", "ripgrep")?.args).toEqual(["install", "--list"]);
    expect(verificationCommandFor("dotnet", "Serilog")?.command).toBe("dotnet");
    expect(verificationCommandFor("composer", "monolog/monolog")?.command).toBe("composer");
    expect(verificationCommandFor("gem", "rake")?.command).toBe("gem");
    expect(verificationCommandFor("apt", "curl")?.command).toBe("dpkg");
    expect(verificationCommandFor("pacman", "htop")?.args).toEqual(["-Q", "htop"]);
    // No post-hoc verification exists — primary exit code is the contract.
    expect(verificationCommandFor("go", "golang.org/x/tools")).toBeNull();
    expect(verificationCommandFor("maven", "com.google:guava")).toBeNull();
  });

  it("accepts maven coordinate syntax in package names", () => {
    expect(validatePackageName("com.google:guava:33.0.0")).toBe("com.google:guava:33.0.0");
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
    await expect(runWithPolicyApproval("install_package", () => managePackage({ manager: "winget", action: "install", name: "Vendor.App" }))).rejects.toThrow("ADMIN_MODE");
    await expect(runWithPolicyApproval("install_package", () => managePackage({ manager: "apt", action: "install", name: "curl" }))).rejects.toThrow("ADMIN_MODE");
    await expect(runWithPolicyApproval("install_package", () => managePackage({ manager: "choco", action: "install", name: "git" }))).rejects.toThrow("ADMIN_MODE");
  });
});
