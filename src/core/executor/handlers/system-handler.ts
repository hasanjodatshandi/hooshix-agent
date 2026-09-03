import os from "node:os";
import type { ToolHandler, ToolHandlerContext } from "./tool-handler.js";
import type { ToolName } from "../../orchestrator/tool-orchestrator.js";
import { getAgentMetrics } from "../../trace/metrics-service.js";

const SYSTEM_TOOLS: ReadonlySet<ToolName> = new Set(["get_system_info", "agent_metrics"]);

export class SystemToolHandler implements ToolHandler {
  canHandle(tool: ToolName): boolean {
    return SYSTEM_TOOLS.has(tool);
  }

  async handle({ tool }: ToolHandlerContext): Promise<unknown> {
    switch (tool) {
      case "get_system_info":
        return { platform: os.platform(), cpu: os.cpus()[0]?.model, memory: os.totalmem() };
      case "agent_metrics":
        return getAgentMetrics();
      default:
        throw new Error(`SystemToolHandler: unsupported tool ${tool}`);
    }
  }
}
