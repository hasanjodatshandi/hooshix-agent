import os from "node:os";
import type { ToolHandler, ToolHandlerContext } from "./tool-handler.js";
import type { ToolName } from "../../orchestrator/tool-orchestrator.js";
import { getAgentMetrics } from "../../trace/metrics-service.js";
import { agentMetricsArguments } from "./metrics-arguments.js";
import { getWorkspaceRoot, listWorkspaceRoots, setActiveWorkspace } from "../../../security/workspace-guard.js";

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
          fileToolsScope: "active workspace only",
          workspaceConfigured: getWorkspaceRoot() !== null,
        };
      }
      case "set_workspace": {
        const path = typeof input.path === "string" ? input.path : "";
        if (!path) throw new Error("set_workspace requires a path argument");
        // Pure selector: only selects the active workspace from the allowed
        // roots pool. It can never expand file-tool scope — that capability
        // (unrestricted mode) was deliberately removed as a security-design
        // regression; scope changes go through add_workspace_roots instead.
        const { resolved, previous } = setActiveWorkspace(path);
        return {
          workspace: resolved,
          previous: previous ?? null,
          fileToolsScope: "active workspace only",
        };
      }
      default:
        throw new Error(`SystemToolHandler: unsupported tool ${tool}`);
    }
  }
}
