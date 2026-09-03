import { z } from "zod";
import type { ToolHandler, ToolHandlerContext } from "./tool-handler.js";
import type { ToolName } from "../../orchestrator/tool-orchestrator.js";
import { managePackage } from "../../../services/package/package-service.js";

const PACKAGE_TOOLS: ReadonlySet<ToolName> = new Set([
  "install_package", "remove_package", "update_package"
]);

const object = z.record(z.string(), z.unknown());

export class PackageToolHandler implements ToolHandler {
  canHandle(tool: ToolName): boolean {
    return PACKAGE_TOOLS.has(tool);
  }

  async handle({ tool, input, correlationId }: ToolHandlerContext): Promise<unknown> {
    const data = object.parse(input);
    const value = z.object({
      manager: z.enum(["npm", "pnpm", "pip", "winget", "choco"]),
      name: z.string(),
      cwd: z.string().default("."),
      timeout: z.number().int().min(1000).max(600000).default(300000)
    }).parse(data);
    const action = tool === "install_package" ? "install" : tool === "remove_package" ? "remove" : "update";
    return managePackage({ ...value, action, correlationId });
  }
}
