import type { ExecutionContext } from "../runtime/execution-context.js";
import { TOOL_CAPABILITIES, validateToolName, type ToolName, type ToolRisk } from "../orchestrator/tool-orchestrator.js";
import { evaluateCommandPermission } from "../../security/permissions/command-permission.js";
import { assertToolPermission } from "../../security/permission.js";
// Circular with workspace-guard (which imports policyDecisionPoint from here)
// — safe in ESM because both modules only reference each other's exports
// inside function bodies, never at module-evaluation time.
import { classifyCommandCwd } from "../../security/workspace-guard.js";
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
  "git_add", "install_package", "remove_package", "update_package",
  "task_rollback"
]);
const approvedTool = new AsyncLocalStorage<ToolName>();

export function runWithPolicyApproval<T>(tool: string, operation: () => Promise<T>): Promise<T> {
  return approvedTool.run(validateToolName(tool), operation);
}

/** Whether approval gates are enforced for direct MCP calls. */
export function isDirectApprovalBypassEnabled(): boolean {
  return process.env.HOOSHIX_DIRECT_AUTO_APPROVE === "1";
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
    if (tool === "execute_command" && request.arguments?.cwdOutsideWorkspace === true) {
      // Internal enforcement marker from validateCommandCwd: the cwd was
      // already classified outside at execution time. Governed escalation.
      return { allowed: true, requiresApproval: true, risk, reason: "Command cwd is outside the active workspace — requires approval" };
    }
    if (tool === "execute_command") {
      const command = request.arguments?.command;
      const args = request.arguments?.args;
      const rawCwd = request.arguments?.cwd;
      if (typeof command !== "string" || (args !== undefined && !Array.isArray(args))) {
        return { allowed: false, requiresApproval: false, risk, reason: "Invalid command policy input" };
      }
      // Subprocess cwd outside the active workspace — filesystem-wide command
      // execution is allowed but ONLY as a governed escalation (approved task
      // step / explicit direct-call opt-in). The boundary is derived HERE, not
      // trusted from arguments, so governance (task loop, task_step_risks)
      // classifies cwd escalations before execution instead of discovering
      // them mid-run inside validateCommandCwd (where the executor's approval
      // context would auto-satisfy the gate — the task_run bypass).
      // ""/"." mean "the task/workspace default" — the handler resolves them
      // to the task's persisted workspace, so there is no explicit cwd
      // escalation to classify here; runtime enforcement still covers the
      // effective cwd. The task loop passes the effective workspace explicitly
      // via checkStepGovernance for the omitted-cwd case.
      if (typeof rawCwd === "string" && rawCwd.length > 0 && rawCwd !== ".") {
        const { inside } = classifyCommandCwd(rawCwd);
        if (!inside) {
          return { allowed: true, requiresApproval: true, risk, reason: "Command cwd is outside the active workspace — requires approval" };
        }
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
    if (decision.requiresApproval) {
      const storeValue = approvedTool.getStore();
      if (storeValue !== undefined && storeValue !== validateToolName(request.tool)) {
        throw new Error(`Approval required: ${request.tool} must run through an approved task step`);
      }
      // Direct MCP call (no task context) — requires explicit opt-in via
      // HOOSHIX_DIRECT_AUTO_APPROVE=1 because the caller and the approver
      // are the same principal in that case.
      if (storeValue === undefined && !isDirectApprovalBypassEnabled()) {
        throw new Error(`Approval required: ${request.tool} must run through an approved task step (set HOOSHIX_DIRECT_AUTO_APPROVE=1 to allow direct calls)`);
      }
    }
    return decision;
  }
}

export const policyDecisionPoint = new PolicyDecisionPoint();
