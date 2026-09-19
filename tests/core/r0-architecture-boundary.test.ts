/**
 * R0 architecture boundary scaffold: protects new Hexagonal/Clean folders as
 * they are introduced, without pretending the legacy tree already meets G1.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type Issue = { file: string; import: string; reason: string };
const sourceRoot = path.resolve("src");
const protectedRoots = ["domain", "application", "adapters/inbound"] as const;

function sourceFiles(folder: string): string[] {
  if (!fs.existsSync(folder)) return [];
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(folder, entry.name);
    if (entry.isDirectory()) return sourceFiles(child);
    return entry.isFile() && /\.[cm]?tsx?$/.test(entry.name) ? [child] : [];
  });
}

export function scanNewArchitectureSource(file: string, source: string): Issue[] {
  const rel = path.relative(sourceRoot, file).replace(/\\/g, "/");
  const isDomain = rel.startsWith("domain/");
  const isApplication = rel.startsWith("application/");
  const isInbound = rel.startsWith("adapters/inbound/");
  if (!isDomain && !isApplication && !isInbound) return [];
  const issues: Issue[] = [];

  if ((isDomain || isApplication) && /\bprocess\s*\.\s*env\b/.test(source)) {
    issues.push({ file: rel, import: "process.env", reason: "environment access outside bootstrap/config" });
  }

  const imports = [
    ...source.matchAll(/\b(?:import|export)\s+(?:(?:type\s+)?[\s\S]*?\s+from\s+)?["']([^"']+)["']/g),
    ...source.matchAll(/\b(?:require|import)\s*\(\s*["']([^"']+)["']\s*\)/g),
  ];
  for (const match of imports) {
    const specifier = match[1];
    if (isDomain || isApplication) {
      if (!specifier.startsWith(".")) {
        issues.push({ file: rel, import: specifier, reason: "Domain/Application cannot import external or Node modules" });
        continue;
      }
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), specifier));
      const validPrefix = isDomain ? ["domain/"] : ["application/", "domain/"];
      if (!validPrefix.some((prefix) => target.startsWith(prefix))) {
        issues.push({ file: rel, import: specifier, reason: "forbidden outward module dependency" });
      }
    } else if (isInbound && specifier.startsWith(".")) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), specifier));
      if (target.startsWith("adapters/outbound/")) {
        issues.push({ file: rel, import: specifier, reason: "inbound adapter cannot depend on an outbound adapter" });
      }
    }
  }
  return issues;
}

describe("R0 new-architecture dependency protection", () => {
  it("rejects a Domain dependency on Node, external libraries or a concrete service", () => {
    const file = path.join(sourceRoot, "domain/task.ts");
    expect(scanNewArchitectureSource(file, 'import fs from "node:fs";')).toHaveLength(1);
    expect(scanNewArchitectureSource(file, 'import x from "../services/git/git-service.js";')).toHaveLength(1);
    expect(scanNewArchitectureSource(file, 'import type { TaskId } from "./task-id.js";')).toEqual([]);
  });

  it("restricts Application imports to Domain and Application", () => {
    const file = path.join(sourceRoot, "application/task/use-case.ts");
    expect(scanNewArchitectureSource(file, 'import { x } from "../../adapters/outbound/sqlite.js";')).toHaveLength(1);
    expect(scanNewArchitectureSource(file, 'import type { Task } from "../../domain/task.js";')).toEqual([]);
  });

  it("rejects environment access and inbound-to-outbound shortcuts", () => {
    expect(scanNewArchitectureSource(path.join(sourceRoot, "application/app.ts"), "const x = process.env.SECRET;")).toHaveLength(1);
    expect(scanNewArchitectureSource(path.join(sourceRoot, "adapters/inbound/mcp.ts"),
      'import { db } from "../outbound/sqlite.js";')).toHaveLength(1);
  });

  it("scans every currently present protected module without grandfathering new violations", () => {
    const files = protectedRoots.flatMap((dir) => sourceFiles(path.join(sourceRoot, dir)));
    const violations = files.flatMap((file) => scanNewArchitectureSource(file, fs.readFileSync(file, "utf8")));
    expect(violations).toEqual([]);
    // Zero files means the scaffold is in place, NOT that R1/G1 is achieved.
  });
});
