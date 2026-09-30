import fs from "node:fs/promises";
import path from "node:path";
import { readLegacyRuntimePaths } from "../infrastructure/config/legacy-runtime-paths.js";

function logPath(): string {
  return path.resolve(readLegacyRuntimePaths().logDirectory, "command-actions.log");
}

const SENSITIVE_PATTERN = /token|secret|password|api[-_]?key|credential|auth[-_]?key|access[-_]?key|private[-_]?key|sign[-_]?key/i;
/** Bare secret values (no =) — high-entropy-looking tokens are redacted too. */
const RAW_SECRET_PATTERN = /^(sk|ghp|gho|github_pat|xoxb|xoxp|AKIA)[-_][A-Za-z0-9_\-]{8,}$/;

/** Treat both --flag=value and --flag VALUE as secret-bearing inputs. */
function redactArguments(args: readonly string[] = []): string[] {
  const masked: string[] = [];
  let redactNext = false;
  for (const argument of args) {
    if (redactNext) {
      masked.push("[REDACTED]");
      redactNext = false;
      continue;
    }
    const sensitiveOption = /^(?:--?|\/)(?:token|secret|password|passphrase|api[-_]?key|credential|auth(?:orization)?|access[-_]?key|private[-_]?key|sign[-_]?key)(?:[-_][a-z0-9]+)*(?:[=:]|$)/i;
    const opaqueValueOption = /^(?:--(?:env|header|data|data-raw|data-binary|json|form)|-e|-H)(?:[=:]|$)/i;
    if (sensitiveOption.test(argument) || opaqueValueOption.test(argument)) {
      const split = argument.search(/[=:]/);
      if (split >= 0) masked.push(argument.slice(0, split + 1) + "[REDACTED]");
      else { masked.push(argument); redactNext = true; }
      continue;
    }
    if (RAW_SECRET_PATTERN.test(argument) || SENSITIVE_PATTERN.test(argument)) {
      const split = argument.indexOf("=");
      masked.push(split < 0 ? "[REDACTED]" : argument.slice(0, split + 1) + "[REDACTED]");
      continue;
    }
    masked.push(argument);
  }
  return masked;
}
import { rotateAuditLogIfNeeded } from "./audit-log-rotation.js";

/**
 * R10.09 — the command audit log is append-only JSONL. It is rotated when it
 * exceeds MAX_AUDIT_LOG_BYTES so a long-running host cannot fill its volume
 * with audit history.
 * audit history. The rotation is not a retention policy (nothing is deleted by
 * age), only a size bound; an operator with stronger needs archives the .1.
 */
export async function logCommandAction(data: {
  command: string;
  args?: string[];
  /** Optional caller-supplied environment is never written verbatim to audit. */
  env?: Readonly<Record<string,string|undefined>>;
  cwd?: string;
  exitCode?: number;
  status: "success" | "failed" | "timeout" | "blocked";
  correlationId: string;
}) {
  const destination = logPath();
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await rotateAuditLogIfNeeded(destination);
  await fs.appendFile(destination, JSON.stringify({
    command: redactArguments([data.command])[0],
    args: redactArguments(data.args),
    cwd: data.cwd === undefined ? undefined : redactArguments([data.cwd])[0],
    exitCode: typeof data.exitCode === "number" && Number.isSafeInteger(data.exitCode) ? data.exitCode : undefined,
    status: data.status,
    correlationId: redactArguments([data.correlationId])[0],
    // Values and even key names may contain credentials; never serialize a raw environment.
    ...(data.env === undefined ? {} : { environment: "[REDACTED]" }),
    timestamp: new Date().toISOString()
  }) + "\n", "utf8");
}
