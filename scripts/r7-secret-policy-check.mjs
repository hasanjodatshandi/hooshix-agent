#!/usr/bin/env node
// CI-only fail-closed scan of ACTIVE deploy surfaces; historical audit evidence is deliberately not rewritten.
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const active = [
  "Dockerfile", "docker-compose.yml", "README.md",
  "scripts/start_nodejs_mcp.bat", "scripts/hooshix_nodejs_mcp_watchdog.ps1",
  "scripts/install_nodejs_mcp_task.bat", "scripts/SETUP_NODEJS_MCP_V2.md",
  "docs/implementation/R7_LOCAL_OPERATIONS_RUNBOOK_2026-09-23.md",
];
const retiredLiteral = ["hooshix", "-v2-secret"].join("");
const failures = [];
for (const file of active) {
  const content = fs.readFileSync(file, "utf8");
  if (content.includes(retiredLiteral)) failures.push(file + ": retired static bootstrap credential");
  if (/\b(?:MCP_API_KEY|MCP_ACCESS_TOKEN)\s*=/.test(content) &&
      !file.endsWith("R7_LOCAL_OPERATIONS_RUNBOOK_2026-09-23.md"))
    failures.push(file + ": deprecated auth env assignment");
  if (/\?token=|\?access_token=/.test(content))
    failures.push(file + ": query-string credential guidance");
}
const tracked = execFileSync("git", ["ls-files", "--cached"], {encoding:"utf8"}).split(/\r?\n/);
const forbidden = /(^|\/)(?:\.token|\.env(?:\.[^/]*)?|[^/]+\.(?:db|db-wal|db-shm|pem|key))$/i;
for (const file of tracked) if (forbidden.test(file)) failures.push(file + ": tracked sensitive/runtime file");
for (const failure of failures) console.error("R7_SECRET_POLICY_FAIL " + failure);
if (failures.length) process.exitCode = 1;
else console.log("R7_SECRET_POLICY_PASS active_deployment_files=" + active.length + " tracked_paths_checked=" + tracked.length);
