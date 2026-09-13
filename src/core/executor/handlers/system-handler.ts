import os from "node:os";
import type { ToolHandler, ToolHandlerContext } from "./tool-handler.js";
import type { ToolName } from "../../orchestrator/tool-orchestrator.js";
import { getAgentMetrics } from "../../trace/metrics-service.js";
import { agentMetricsArguments } from "./metrics-arguments.js";
import { getWorkspaceRoot, listWorkspaceRoots, setActiveWorkspace, setUnrestrictedMode, isUnrestrictedMode } from "../../../security/workspace-guard.js";

const SYSTEM_TOOLS: ReadonlySet<ToolName> = new Set(["get_system_info", "agent_metrics", "get_workspace", "set_workspace"]);

export class SystemToolHandler implements ToolHandler {
  canHandle(tool: ToolName): boolean {
    return SYSTEM_TOOLS.has(tool);
  }

  async handle({ tool, input }: ToolHandlerContext): Promise<unknown> {
    switch (tool) {
      case "get_system_info":
        return { platform: os.platform(), cpu: os.cpus()[0]?.model, memory: os.totalmem() };
      case "agent_metrics": {
        const value = agentMetricsArguments.parse(input ?? {});
        return getAgentMetrics(value);
      }
      case "get_workspace": {
        return {
          active: getWorkspaceRoot(),
          roots: listWorkspaceRoots(),
          unrestricted: isUnrestrictedMode(),
        };
      }
      case "set_workspace": {
        const path = typeof input.path === "string" ? input.path : "";
        if (!path) throw new Error("set_workspace requires a path argument");
        const { resolved, previous } = setActiveWorkspace(path);
        if (typeof input.unrestricted === "boolean") {
          setUnrestrictedMode(input.unrestricted);
        }
        return {
          workspace: resolved,
          previous: previous ?? null,
          unrestricted: isUnrestrictedMode(),
        };
      }
      default:
        throw new Error(`SystemToolHandler: unsupported tool ${tool}`);
    }
  }
}
