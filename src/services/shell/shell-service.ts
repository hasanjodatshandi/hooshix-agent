import { spawn, type SpawnOptions } from "../spawn.js";
import { validateCommand } from "../../security/command-validator.js";
import { policyDecisionPoint } from "../../core/governance/policy-decision-point.js";
import { logCommandAction } from "../../memory/command-audit.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";
import { assertCwdExists } from "../execa-result.js";
import { validateCommandCwd, getActiveWorkspace } from "../../security/workspace-guard.js";
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
    // Empty-by-default pool: with no active workspace, there is no "inside"
    // anywhere — every cwd is an unapprovable escalation. Fail closed here
    // before touching the filesystem, with an actionable message.
    const activeWorkspace = getActiveWorkspace();
    if (activeWorkspace === null) {
      throw new Error("Access denied: no active workspace — configure one with add_workspace_roots + set_workspace before running commands.");
    }
    // Fail fast on a non-existent cwd instead of a confusing spawn failure.
    assertCwdExists(safeCwd, "Working directory");
    // Subprocess filesystem scope: the cwd must be inside the ACTIVE workspace,
    // otherwise the call is an escalation requiring approval (direct calls need
    // HOOSHIX_DIRECT_AUTO_APPROVE=1). Unrestricted mode does not bypass this.
    const allowedCwd = validateCommandCwd(safeCwd);
    policyDecisionPoint.assertAllowed({ tool: "execute_command", arguments: { command, args, cwd: allowedCwd, timeout }, correlationId: traceId });
    validateCommand(command, args);

    const spawnOpts: SpawnOptions = {
      cwd: allowedCwd,
      timeout,
      shell: false,
      reject: false,
      // Build tooling is verbose: a real Gradle/SpotBugs/Jacoco run emits far
      // more than 1MB, and execa KILLS the subprocess once a stream crosses
      // maxBuffer — turning a healthy long build into an unexplained failure
      // with truncated output. 16MB covers realistic build output; the result
      // flags `outputTruncated` if a stream is ever cut short.
      maxBuffer: 16 * 1024 * 1024,
    };
    if (signal) spawnOpts.cancelSignal = signal;
    // The child receives only the allowlisted environment — no HOOSHIX_*
    // secrets. services/spawn.ts is the sole spawn path in this process.
    const result = await spawn(command, args, spawnOpts);
    if (result.timedOut) throw Object.assign(new Error("Command execution timed out"), { timedOut: true });
    // A process killed by a signal or canceled by the step's AbortController
    // never produced an exit code — there is no command outcome to report, only
    // an interrupted run. Fail as an infrastructure error so the caller
    // reconciles, instead of returning a result the gateway would treat as a
    // successful invocation with an undefined exit code.
    if (result.isCanceled || result.exitCode === undefined) {
      throw Object.assign(new Error("Command execution was canceled before it could exit"), { canceled: true });
    }
    const status = result.exitCode === 0 ? "success" : "failed";
    await logCommandAction({ command, args, cwd: safeCwd, exitCode: result.exitCode, status, correlationId: traceId });
    // A non-zero exit is the COMMAND's outcome, not a tool failure: return it so
    // the caller sees the real exit code and output (the shell handler relies on
    // this; the task loop marks the step failed via the reported exit code).
    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      outputTruncated: result.isMaxBuffer === true,
      correlationId: traceId,
    };
  } catch (error) {
    const timedOut = Boolean((error as { timedOut?: boolean }).timedOut);
    const blocked = error instanceof Error && /blocked|approval required|not allowed|outside workspace|access denied/i.test(error.message);
    await logCommandAction({ command, args, cwd, status: timedOut ? "timeout" : blocked ? "blocked" : "failed", correlationId: traceId });
    throw error;
  }
}
