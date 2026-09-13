import { z } from "zod";
import type { ToolHandler, ToolHandlerContext } from "./tool-handler.js";
import type { ToolName } from "../../orchestrator/tool-orchestrator.js";
import { executeShellCommand } from "../../../services/shell/shell-service.js";
import { describeExecaFailure } from "../../../services/execa-result.js";

const SHELL_TOOLS: ReadonlySet<ToolName> = new Set(["execute_command"]);

const object = z.record(z.string(), z.unknown());

export class ShellToolHandler implements ToolHandler {
  canHandle(tool: ToolName): boolean {
    return SHELL_TOOLS.has(tool);
  }

  async handle({ input, correlationId, executionContext, signal }: ToolHandlerContext): Promise<unknown> {
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
    const cwd = value.cwd ?? executionContext?.workspace ?? ".";
    const result = await executeShellCommand(value.command, value.args, cwd, value.timeout, correlationId, signal);
    if (result.exitCode !== 0) throw new Error(result.stderr || describeExecaFailure(value.command, result));
    return result;
  }
}
