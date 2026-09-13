import { execa } from "execa";
import { validateCommand } from "../../security/command-validator.js";
import { policyDecisionPoint } from "../../core/governance/policy-decision-point.js";
import { logCommandAction } from "../../memory/command-audit.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";
import { assertCwdExists } from "../execa-result.js";
import { validateCommandCwd } from "../../security/workspace-guard.js";
import path from "node:path";

export async function executeShellCommand(
  command: string,
  args: string[] = [],
  cwd = ".",
  timeout = 30000,
  correlationId?: string,
  signal?: AbortSignal
) {
  command = command.toLowerCase();
  const traceId = resolveCorrelationId(correlationId);

  try {
    const safeCwd = path.resolve(cwd);
    // Fail fast on a non-existent cwd instead of a confusing spawn failure.
    assertCwdExists(safeCwd, "Working directory");
    // Subprocess filesystem scope: the cwd must be inside the ACTIVE workspace,
    // otherwise the call is an escalation requiring approval (direct calls need
    // HOOSHIX_DIRECT_AUTO_APPROVE=1). Unrestricted mode does not bypass this.
    const allowedCwd = validateCommandCwd(safeCwd);
    // Auto-prepend -Command for PowerShell so bare invocations behave as scripts.
    // Do this BEFORE the policy check so the PDP evaluates the actual argv shape.
    if (command === "powershell" && args.length > 0 && args[0] !== "-Command" && args[0] !== "-c") {
      args = ["-Command", ...args];
    }
    policyDecisionPoint.assertAllowed({ tool: "execute_command", arguments: { command, args, cwd: allowedCwd, timeout }, correlationId: traceId });
    validateCommand(command, args);

    const execaOpts: Record<string, unknown> = {
      cwd: allowedCwd,
      timeout,
      shell: false,
      reject: false,
      maxBuffer: 1024 * 1024
    };
    if (signal) execaOpts.cancelSignal = signal;
    const result = await execa(command, args, execaOpts);
    const status = result.timedOut ? "timeout" : result.exitCode === 0 ? "success" : "failed";
    if (result.timedOut) throw Object.assign(new Error("Command execution timed out"), { timedOut: true });
    await logCommandAction({ command, args, cwd: safeCwd, exitCode: result.exitCode, status, correlationId: traceId });
    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, correlationId: traceId };
  } catch (error) {
    const timedOut = Boolean((error as { timedOut?: boolean }).timedOut);
    const blocked = error instanceof Error && /blocked|approval required|not allowed|outside workspace|access denied/i.test(error.message);
    await logCommandAction({ command, args, cwd, status: timedOut ? "timeout" : blocked ? "blocked" : "failed", correlationId: traceId });
    throw error;
  }
}
