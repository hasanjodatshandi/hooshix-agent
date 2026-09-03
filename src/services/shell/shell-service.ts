import { execa } from "execa";
import { validateCommand } from "../../security/command-validator.js";
import { policyDecisionPoint } from "../../core/governance/policy-decision-point.js";
import { logCommandAction } from "../../memory/command-audit.js";
import { validateWorkspace } from "../../security/workspace-guard.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";
import path from "node:path";

export async function executeShellCommand(
  command: string,
  args: string[] = [],
  cwd = ".",
  timeout = 30000,
  correlationId?: string
) {
  command = command.toLowerCase();
  const traceId = resolveCorrelationId(correlationId);
  let safeCwd: string | undefined;

  try {
    safeCwd = validateWorkspace(cwd);
    policyDecisionPoint.assertAllowed({ tool: "execute_command", arguments: { command, args, cwd, timeout }, correlationId: traceId });
    validateCommand(command, args);
    if (["node", "python", "py"].includes(command) && args[0] && !args[0].startsWith("-")) validateWorkspace(path.resolve(safeCwd, args[0]));
    if (command === "powershell") validateWorkspace(path.resolve(safeCwd, args[1]));

    const result = await execa(command, args, {
      cwd: safeCwd,
      timeout,
      shell: false,
      reject: false,
      maxBuffer: 1024 * 1024
    });
    const status = result.timedOut ? "timeout" : result.exitCode === 0 ? "success" : "failed";
    if (result.timedOut) throw Object.assign(new Error("Command execution timed out"), { timedOut: true });
    await logCommandAction({ command, args, cwd: safeCwd, exitCode: result.exitCode, status, correlationId: traceId });
    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, correlationId: traceId };
  } catch (error) {
    const timedOut = Boolean((error as { timedOut?: boolean }).timedOut);
    const blocked = error instanceof Error && /blocked|approval required|not allowed|outside workspace|access denied/i.test(error.message);
    await logCommandAction({ command, args, cwd: safeCwd ?? cwd, status: timedOut ? "timeout" : blocked ? "blocked" : "failed", correlationId: traceId });
    throw error;
  }
}
