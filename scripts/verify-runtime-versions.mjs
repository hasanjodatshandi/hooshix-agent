#!/usr/bin/env node
/**
 * R7.08 runtime toolchain gate.
 *
 * Verifies that the Node.js and pnpm available on this machine match the exact
 * lines the project pins (.nvmrc and package.json `packageManager`) BEFORE any
 * build or service start. A mismatch or a missing package manager must fail the
 * launch loudly instead of producing an inconsistent artifact.
 *
 * Documented test hooks (never used in production):
 *   HOOSHIX_PREFLIGHT_NODE_VERSION  override the detected Node version (e.g. "v23.0.0")
 *   HOOSHIX_PREFLIGHT_PNPM_VERSION  override the detected pnpm version
 *   HOOSHIX_PREFLIGHT_PNPM_MISSING=1 simulate pnpm being absent from PATH
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readExpected() {
  const nodeExact = fs.readFileSync(path.join(repo, ".nvmrc"), "utf8").trim();
  if (!/^\d+\.\d+\.\d+$/.test(nodeExact))
    throw new Error(`unexpected .nvmrc content: ${JSON.stringify(nodeExact)}`);
  const pkg = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8"));
  const match = /^pnpm@(\d+\.\d+\.\d+)$/.exec(String(pkg.packageManager ?? ""));
  if (!match) throw new Error("package.json packageManager must be pinned as pnpm@<exact>");
  return { nodeExact, nodeMajor: Number(nodeExact.split(".")[0]), pnpmExact: match[1] };
}

function detectedNodeVersion(expected) {
  const override = process.env.HOOSHIX_PREFLIGHT_NODE_VERSION;
  if (override) return override;
  // The currently executing Node is the one that will run the service and build.
  return process.version.replace(/^v/, "");
}

function detectedPnpmVersion() {
  if (process.env.HOOSHIX_PREFLIGHT_PNPM_MISSING === "1") return undefined;
  const override = process.env.HOOSHIX_PREFLIGHT_PNPM_VERSION;
  if (override) return override;
  let stdout;
  try {
    // Resolved from PATH exactly as the service scripts would resolve it. A shell
    // is required on Windows where pnpm is a .cmd/.ps1 shim, not a bare executable.
    stdout = execFileSync("pnpm", ["--version"], {
      encoding: "utf8",
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    if (error && (error.code === "ENOENT" || error.status === 127)) return undefined;
    throw error;
  }
  return stdout.trim();
}

function verdict(input, expected) {
  if (!input.nodeVersion)
    return { ok: false, reason: "Node.js version is unavailable; the runtime cannot be verified." };
  const nodeMatch = /^(\d+)\.(\d+)\.(\d+)/.exec(input.nodeVersion);
  if (!nodeMatch)
    return { ok: false, reason: `Unparseable Node.js version: ${input.nodeVersion}` };
  const major = Number(nodeMatch[1]);
  if (major !== expected.nodeMajor)
    return {
      ok: false,
      reason: `HooshiX requires Node.js ${expected.nodeMajor}.x (pinned ${expected.nodeExact}); detected ${input.nodeVersion}.`,
    };
  if (input.nodeVersion !== expected.nodeExact)
    return {
      ok: false,
      reason: `HooshiX pins Node.js ${expected.nodeExact}; detected ${input.nodeVersion}. Update via .nvmrc-approved tooling.`,
    };
  if (input.pnpmVersion === undefined)
    return { ok: false, reason: `pnpm is not installed or not reachable on PATH; install pnpm@${expected.pnpmExact}.` };
  if (input.pnpmVersion !== expected.pnpmExact)
    return {
      ok: false,
      reason: `HooshiX requires pnpm ${expected.pnpmExact}; detected ${input.pnpmVersion}.`,
    };
  return { ok: true };
}

const expected = readExpected();
const result = verdict(
  { nodeVersion: detectedNodeVersion(expected), pnpmVersion: detectedPnpmVersion() },
  expected,
);
if (result.ok) {
  process.stdout.write(
    `runtime toolchain ok: node ${expected.nodeExact}, pnpm ${expected.pnpmExact}\n`,
  );
  process.exit(0);
}
process.stderr.write(`runtime toolchain check failed: ${result.reason}\n`);
process.exit(1);
