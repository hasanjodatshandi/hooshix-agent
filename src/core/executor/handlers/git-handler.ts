import { z } from "zod";
import type { ToolHandler, ToolHandlerContext } from "./tool-handler.js";
import type { ToolName } from "../../orchestrator/tool-orchestrator.js";
import { gitStatus, gitDiff, gitClone, gitCommit, gitBranch, gitCheckout } from "../../../services/git/git-service.js";

const GIT_TOOLS: ReadonlySet<ToolName> = new Set([
  "git_status", "git_diff", "git_clone", "git_commit", "git_branch", "git_checkout"
]);

const object = z.record(z.string(), z.unknown());

export class GitToolHandler implements ToolHandler {
  canHandle(tool: ToolName): boolean {
    return GIT_TOOLS.has(tool);
  }

  async handle({ tool, input, correlationId }: ToolHandlerContext): Promise<unknown> {
    const data = object.parse(input);
    switch (tool) {
      case "git_status": {
        const value = z.object({ cwd: z.string().default(".") }).parse(data);
        return gitStatus(value.cwd, correlationId);
      }
      case "git_diff": {
        const value = z.object({ cwd: z.string().default("."), staged: z.boolean().default(false) }).parse(data);
        return gitDiff(value.cwd, value.staged, correlationId);
      }
      case "git_clone": {
        const value = z.object({ url: z.url(), path: z.string() }).parse(data);
        return gitClone(value.url, value.path, correlationId);
      }
      case "git_commit": {
        const value = z.object({ cwd: z.string().default("."), message: z.string().min(1).max(500) }).parse(data);
        return gitCommit(value.cwd, value.message, correlationId);
      }
      case "git_branch": {
        const value = z.object({ cwd: z.string().default("."), name: z.string() }).parse(data);
        return gitBranch(value.cwd, value.name, correlationId);
      }
      case "git_checkout": {
        const value = z.object({ cwd: z.string().default("."), name: z.string(), create: z.boolean().default(false) }).parse(data);
        return gitCheckout(value.cwd, value.name, value.create, correlationId);
      }
      default:
        throw new Error(`GitToolHandler: unsupported tool ${tool}`);
    }
  }
}
