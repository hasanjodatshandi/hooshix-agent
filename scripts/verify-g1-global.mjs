#!/usr/bin/env node
/**
 * Strict GLOBAL G1 architectural debt report.
 * No grandfathering: legacy violations remain blockers until migrated.
 * Static scanner is conservative and reports candidate SQL/SDK imports,
 * with exact paths for manual adjudication. It does not alter source.
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("src");
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const current = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(current);
    else if (entry.isFile() && /\.[cm]?tsx?$/.test(entry.name)) files.push(current);
  }
}
walk(root);
const findings = [];
function record(file, category, detail) {
  findings.push({ file: path.relative(root, file).replace(/\\/g, "/"), category, detail });
}
const sql = /\b(?:SELECT\s+[^;\r\n]*\bFROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE)\b/i;
for (const file of files) {
  const relative = path.relative(root, file).replace(/\\/g, "/");
  const code = fs.readFileSync(file, "utf8");
  const domain = relative.startsWith("domain/");
  const application = relative.startsWith("application/");
  const inbound = relative.startsWith("adapters/inbound/");
  if (/\bprocess\s*\.\s*env\b/.test(code) && !(relative.startsWith("infrastructure/config/") || relative.startsWith("bootstrap/"))) {
    record(file, "env_outside_config", "Direct environment access outside config/bootstrap");
  }
  if (sql.test(code) && !(relative.startsWith("adapters/outbound/persistence/sqlite/") || /(?:^|\/)migrations?\//.test(relative) || /(?:^|\/)database\/migrations\.ts$/.test(relative))) {
    record(file, "sql_outside_sqlite_adapter", "SQL-like source text outside canonical SQLite adapter/migrations");
  }
  const importPattern = /\b(?:import|export)\s+(?:(?:type\s+)?[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;
  for (const match of code.matchAll(importPattern)) {
    const spec = match[1];
    const resolved = spec.startsWith(".")
      ? path.posix.normalize(path.posix.join(path.posix.dirname(relative), spec))
      : spec;
    if (domain && !resolved.startsWith("domain/")) record(file, "domain_outbound_dependency", spec);
    if (application && !(resolved.startsWith("application/") || resolved.startsWith("domain/"))) record(file, "application_outbound_dependency", spec);
    if (inbound && resolved.startsWith("adapters/outbound/")) record(file, "inbound_to_outbound", spec);
    if (spec.startsWith("@modelcontextprotocol/sdk/") && !relative.startsWith("adapters/inbound/mcp/")) {
      record(file, "sdk_outside_inbound_mcp", spec);
    }
  }
}
const unique = [...new Map(findings.map(f => [JSON.stringify(f), f])).values()];
const byCategory = {};
for (const f of unique) (byCategory[f.category] ??= []).push(f.file);
const summary = Object.fromEntries(Object.entries(byCategory).map(([category, matches]) => [category, [...new Set(matches)].sort()]));
console.log(JSON.stringify({
  gate: "G1_GLOBAL",
  status: unique.length ? "NOT_PASSED" : "PASS",
  scannedFiles: files.length,
  categories: summary,
  candidateCount: unique.length,
  candidateDisclaimer: "Static matches must be reviewed; never mark G1 PASS while verified violations remain.",
}, null, 2));
if (process.argv.includes("--strict") && unique.length) process.exitCode = 2;
