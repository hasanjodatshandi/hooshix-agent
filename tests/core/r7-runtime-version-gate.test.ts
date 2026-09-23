import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const script = path.resolve("scripts", "verify-runtime-versions.mjs");

function run(env: Readonly<Record<string, string | undefined>>) {
  return spawnSync(process.execPath, [script], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: "utf8",
    windowsHide: true,
    timeout: 20000,
  });
}

describe("R7.08 runtime toolchain gate", () => {
  it("agrees with .nvmrc and the pinned package manager contract", () => {
    const nvmrc = fs.readFileSync(path.resolve(".nvmrc"), "utf8").trim();
    const pkg = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8"));
    expect(nvmrc).toBe("24.18.0");
    expect(String(pkg.packageManager)).toBe("pnpm@11.24.0");
  });
  it("passes on the current development toolchain", () => {
    const result = run({});
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("runtime toolchain ok");
  });
  it("fails when the Node major line is wrong", () => {
    const result = run({ HOOSHIX_PREFLIGHT_NODE_VERSION: "23.0.0" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("requires Node.js 24");
  });
  it("fails when the Node patch line drifts from .nvmrc", () => {
    const result = run({ HOOSHIX_PREFLIGHT_NODE_VERSION: "24.17.0" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("pins Node.js");
  });
  it("fails when pnpm is missing from PATH", () => {
    const result = run({ HOOSHIX_PREFLIGHT_PNPM_MISSING: "1" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("pnpm is not installed");
  });
  it("fails when the pnpm version does not match the pinned contract", () => {
    const result = run({ HOOSHIX_PREFLIGHT_PNPM_VERSION: "11.23.0" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("requires pnpm 11.24.0");
  });
  it("fails on an unparseable Node version", () => {
    const result = run({ HOOSHIX_PREFLIGHT_NODE_VERSION: "not-a-version" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Unparseable Node.js version");
  });
});
