import fs from "node:fs/promises";
import path from "node:path";

function logPath(): string {
  return path.resolve(process.env.HOOSHIX_LOG_DIR ?? "./logs", "command-actions.log");
}

const SENSITIVE_PATTERN = /token|secret|password|api[-_]?key|credential|auth[-_]?key|access[-_]?key|private[-_]?key|sign[-_]?key/i;

function redactArguments(args: string[] = []): string[] {
  let redactNext = false;
  return args.map((argument) => {
    if (redactNext) {
      redactNext = false;
      return "[REDACTED]";
    }
    if (SENSITIVE_PATTERN.test(argument)) {
      redactNext = !argument.includes("=");
      return argument.includes("=") ? `${argument.split("=", 1)[0]}=[REDACTED]` : argument;
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
