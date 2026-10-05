import { z } from "zod";
import type { ToolHandler, ToolHandlerContext } from "./tool-handler.js";
import type { ToolName } from "../../../application/services/legacy-tool-orchestrator.js";
import { executeShellCommand } from "../../../services/shell/shell-service.js";
import { executeUnrestrictedCommand, EXEC_MAX_TIMEOUT } from "../../../services/shell/exec-service.js";

const SHELL_TOOLS: ReadonlySet<ToolName> = new Set(["execute_command", "exec"]);

const object = z.record(z.string(), z.unknown());

export class ShellToolHandler implements ToolHandler {
  canHandle(tool: ToolName): boolean {
    return SHELL_TOOLS.has(tool);
  }

  async handle({ tool, input, correlationId, executionContext, signal }: ToolHandlerContext): Promise<unknown> {
    if (tool === "exec") return this.handleExec(input, correlationId, signal);
    return this.handleExecuteCommand(input, correlationId, executionContext, signal);
  }

  private async handleExecuteCommand(
    input: Record<string, unknown>,
    correlationId: string,
    executionContext: ToolHandlerContext["executionContext"],
    signal?: AbortSignal,
  ): Promise<unknown> {
    const data = object.parse(input);
    const value = z.object({
      command: z.string(),
      args: z.array(z.string()).default([]),
      cwd: z.string().optional(),
      timeout: z.number().int().min(100).max(120000).default(30000)
    }).parse(data);
    // Default cwd to the task's persisted workspace if not explicitly provided.
    // With the empty-by-default pool, executionContext?.workspace can be null —
    // then executeShellCommand's validation denies every cwd (no active
    // workspace), which is the fail-closed contract.
    const cwd = !value.cwd || value.cwd === "." ? (executionContext?.workspace ?? ".") : value.cwd;
    // A process that ran to completion — including one that exited non-zero —
    // is a *successful tool invocation*: the tool's job was to run the command
    // and report its outcome, and it did. Returning the result here hands the
    // caller the real exitCode/stdout/stderr.
    //
    // Previously this threw `new Error(result.stderr || ...)` on exitCode !== 0,
    // which execute-tool.usecase collapsed through classifyHandlerFailure into
    // an opaque `tool_handler_failure` (or a misleading `invalid_argument` when
    // the stderr happened to contain the word "argument"). The caller then saw
    // neither the exit code nor the output — e.g. a Gradle validation
    // (spotlessCheck/test) that legitimately exits 1 looked like an internal
    // fault. Infrastructure failures the tool could not satisfy (no active
    // workspace, permission denied, blocked command, spawn failure, timeout)
    // still throw from executeShellCommand itself, which is correct: those are
    // cases where there is no process result to report.
    return executeShellCommand(value.command, value.args, cwd, value.timeout, correlationId, signal);
  }

  private async handleExec(
    input: Record<string, unknown>,
    correlationId: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const data = object.parse(input);
    const value = z.object({
      command: z.string().min(1),
      cwd: z.string().optional(),
      timeout: z.number().int().min(100).max(EXEC_MAX_TIMEOUT).default(600000),
      shell: z.string().optional(),
    }).parse(data);
    // Unrestricted by design: the exec service enforces only its access gate
    // (ADMIN_MODE + HOOSHIX_EXEC_ENABLED=1) and audits the call. Any cwd —
    // including one outside every workspace — is accepted, as are commands the
    // execute_command policy would refuse.
    return executeUnrestrictedCommand(value.command, { cwd: value.cwd, timeout: value.timeout, shell: value.shell }, correlationId, signal);
  }
}
