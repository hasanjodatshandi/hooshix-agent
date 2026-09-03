import type { ExecutionContext } from "../runtime/execution-context.js";
import { TOOL_CAPABILITIES, validateToolName, type ToolName, type ToolRisk } from "../orchestrator/tool-orchestrator.js";
import { evaluateCommandPermission } from "../../security/permissions/command-permission.js";
import { assertToolPermission } from "../../security/permission.js";
import { AsyncLocalStorage } from "node:async_hooks";

export interface PolicyRequest {
  tool: string;
  arguments?: Record<string, unknown>;
  userContext?: ExecutionContext;
  riskLevel?: ToolRisk;
  correlationId?: string;
}

export interface PolicyDecision {
  allowed: boolean;
  requiresApproval: boolean;
  risk: ToolRisk;
  reason: string;
}

const APPROVAL_TOOLS = new Set<ToolName>([
  "delete_file", "git_clone", "git_commit", "git_branch", "git_checkout",
  "install_package", "remove_package", "update_package"
]);
const approvedTool = new AsyncLocalStorage<ToolName>();

export function runWithPolicyApproval<T>(tool: string, operation: () => Promise<T>): Promise<T> {
  return approvedTool.run(validateToolName(tool), operation);
}

export class PolicyDecisionPoint {
  evaluate(request: PolicyRequest): PolicyDecision {
    let tool: ToolName;
    try {
      tool = validateToolName(request.tool);
      assertToolPermission(tool === "install_package" || tool === "remove_package" || tool === "update_package" ? "package_manage" : tool);
    } catch (error) {
      return { allowed: false, requiresApproval: false, risk: request.riskLevel ?? "critical", reason: error instanceof Error ? error.message : String(error) };
    }

    const risk = request.riskLevel ?? TOOL_CAPABILITIES[tool].risk;
    if (tool === "execute_command") {
      const command = request.arguments?.command;
      const args = request.arguments?.args;
      if (typeof command !== "string" || (args !== undefined && !Array.isArray(args))) {
        return { allowed: false, requiresApproval: false, risk, reason: "Invalid command policy input" };
      }
      const commandDecision = evaluateCommandPermission(command.toLowerCase(), (args ?? []) as string[]);
      if (commandDecision.decision === "blocked") return { allowed: false, requiresApproval: false, risk: "high", reason: `Command blocked: ${command}` };
      if (commandDecision.decision === "approval_required") return { allowed: true, requiresApproval: true, risk, reason: `Command requires approval: ${command}` };
    }

    if (APPROVAL_TOOLS.has(tool)) {
      return { allowed: true, requiresApproval: true, risk, reason: `${tool} is a governed ${risk}-risk operation` };
    }
    return { allowed: true, requiresApproval: false, risk, reason: "Policy allows this operation" };
  }

  assertAllowed(request: PolicyRequest): PolicyDecision {
    const decision = this.evaluate(request);
    if (!decision.allowed) throw new Error(decision.reason);
    if (decision.requiresApproval && approvedTool.getStore() !== validateToolName(request.tool)) {
      throw new Error(`Approval required: ${request.tool} must run through an approved task step`);
    }
    return decision;
  }
}

export const policyDecisionPoint = new PolicyDecisionPoint();
