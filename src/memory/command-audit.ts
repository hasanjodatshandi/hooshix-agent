import fs from "node:fs/promises";
import path from "node:path";
import { readLegacyRuntimePaths } from "../infrastructure/config/legacy-runtime-paths.js";

function logPath(): string {
  return path.resolve(readLegacyRuntimePaths().logDirectory, "command-actions.log");
}

const SENSITIVE_PATTERN = /token|secret|password|api[-_]?key|credential|auth[-_]?key|access[-_]?key|private[-_]?key|sign[-_]?key/i;
/** Bare secret values (no =) — high-entropy-looking tokens are redacted too. */
const RAW_SECRET_PATTERN = /^(sk|ghp|gho|github_pat|xoxb|xoxp|AKIA)[-_][A-Za-z0-9_\-]{8,}$/;

function redactArguments(args: string[] = []): string[] {
  let redactNext = false;
  return args.map((argument) => {
    if (redactNext) {
      redactNext = false;
      return "[REDACTED]";
    }
    // Bare secret value that merely contains a keyword (old behavior logged it
    // verbatim) or a recognizable raw token prefix — redact, don't log.
    if (RAW_SECRET_PATTERN.test(argument)) return "[REDACTED]";
    if (SENSITIVE_PATTERN.test(argument)) {
      if (argument.includes("=")) {
        return `${argument.split("=", 1)[0]}=[REDACTED]`;
      }
      // Keyword present without "=" — treat the whole argument as a secret value
      return "[REDACTED]";
    }
    return argument;
  });
}

export async function logCommandAction(data: {
  command: string;
  args?: string[];
  cwd?: string;
  exitCode?: number;
  status: "success" | "failed" | "timeout" | "blocked";
  correlationId: string;
}) {
  const destination = logPath();
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.appendFile(destination, JSON.stringify({
    ...data,
    args: redactArguments(data.args),
    timestamp: new Date().toISOString()
  }) + "\n", "utf8");
}
