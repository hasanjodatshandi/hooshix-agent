import { z } from "zod";
import type { ToolHandler, ToolHandlerContext } from "./tool-handler.js";
import type { ToolName } from "../../orchestrator/tool-orchestrator.js";
import { executeShellCommand } from "../../../services/shell/shell-service.js";

const SHELL_TOOLS: ReadonlySet<ToolName> = new Set(["execute_command"]);

const object = z.record(z.string(), z.unknown());

export class ShellToolHandler implements ToolHandler {
  canHandle(tool: ToolName): boolean {
    return SHELL_TOOLS.has(tool);
  }

  async handle({ input, correlationId }: ToolHandlerContext): Promise<unknown> {
    const data = object.parse(input);
    const value = z.object({
      command: z.string(),
      args: z.array(z.string()).default([]),
      cwd: z.string().default("."),
      timeout: z.number().int().min(100).max(120000).default(30000)
    }).parse(data);
    const result = await executeShellCommand(value.command, value.args, value.cwd, value.timeout, correlationId);
    if (result.exitCode !== 0) throw new Error(result.stderr || `${value.command} exited with code ${result.exitCode}`);
    return result;
  }
}
