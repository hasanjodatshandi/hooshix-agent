import { afterEach, describe, expect, it } from "vitest";
import { canTransition, transitionTask } from "../../src/core/state/task-state-machine.js";
import { PolicyDecisionPoint } from "../../src/core/governance/policy-decision-point.js";
import { ToolSelector, validateToolArguments, validateToolName } from "../../src/core/orchestrator/tool-orchestrator.js";
import { createTaskRuntimeService } from "../../src/core/runtime/composition-root.js";

const originalPermission = process.env.HOOSHIX_PERMISSION_LEVEL;
afterEach(() => {
  if (originalPermission === undefined) delete process.env.HOOSHIX_PERMISSION_LEVEL;
  else process.env.HOOSHIX_PERMISSION_LEVEL = originalPermission;
});

describe("architecture hardening", () => {
  it("supports approval, checkpoint, recovery, resume, and cancellation transitions", () => {
    expect(transitionTask("executing", "checkpointing")).toBe("checkpointing");
    expect(transitionTask("checkpointing", "recovering")).toBe("recovering");
    expect(transitionTask("recovering", "waiting_approval")).toBe("waiting_approval");
    expect(transitionTask("waiting_approval", "resuming")).toBe("resuming");
    expect(canTransition("resuming", "executing")).toBe(true);
    expect(canTransition("completed", "executing")).toBe(false);
    expect(() => transitionTask("cancelled", "executing")).toThrow("Invalid transition");
  });

  it("centralizes permission, command, and approval decisions", () => {
    const policy = new PolicyDecisionPoint();
    expect(policy.evaluate({ tool: "read_file", arguments: { path: "README.md" } })).toMatchObject({ allowed: true, requiresApproval: false });
    expect(policy.evaluate({ tool: "delete_file", arguments: { path: "x" } })).toMatchObject({ allowed: true, requiresApproval: true, risk: "high" });
    expect(policy.evaluate({ tool: "execute_command", arguments: { command: "node", args: ["shutdown", "/s"] } })).toMatchObject({ allowed: false });
    process.env.HOOSHIX_PERMISSION_LEVEL = "READ_ONLY";
    expect(policy.evaluate({ tool: "write_file", arguments: { path: "x", content: "x" } })).toMatchObject({ allowed: false });
  });

  it("validates tool names and required schema fields before execution", () => {
    expect(validateToolName("read_file")).toBe("read_file");
    expect(() => validateToolName("read_flie")).toThrow("Unknown tool");
    expect(() => validateToolArguments("read_file", {})).toThrow("missing path");
    expect(new ToolSelector().select({ id: 1, action: "inspect system metrics", status: "pending" })).toBe("get_system_info");
  });

  it("exhaustively verifies all valid and invalid state transitions", () => {
    // Valid transitions from each state
    expect(canTransition("created", "planning")).toBe(true);
    expect(canTransition("created", "cancelled")).toBe(true);
    expect(canTransition("planning", "executing")).toBe(true);
    expect(canTransition("planning", "waiting_approval")).toBe(true);
    expect(canTransition("planning", "failed")).toBe(true);
    expect(canTransition("planning", "cancelled")).toBe(true);
    expect(canTransition("waiting_approval", "resuming")).toBe(true);
    expect(canTransition("waiting_approval", "failed")).toBe(true);
    expect(canTransition("waiting_approval", "cancelled")).toBe(true);
    expect(canTransition("executing", "checkpointing")).toBe(true);
    expect(canTransition("executing", "waiting_approval")).toBe(true);
    expect(canTransition("executing", "recovering")).toBe(true);
    expect(canTransition("executing", "verifying")).toBe(true);
    expect(canTransition("executing", "failed")).toBe(true);
    expect(canTransition("executing", "cancelled")).toBe(true);
    expect(canTransition("checkpointing", "executing")).toBe(true);
    expect(canTransition("checkpointing", "waiting_approval")).toBe(true);
    expect(canTransition("checkpointing", "recovering")).toBe(true);
    expect(canTransition("checkpointing", "verifying")).toBe(true);
    expect(canTransition("checkpointing", "failed")).toBe(true);
    expect(canTransition("checkpointing", "cancelled")).toBe(true);
    expect(canTransition("recovering", "executing")).toBe(true);
    expect(canTransition("recovering", "waiting_approval")).toBe(true);
    expect(canTransition("recovering", "failed")).toBe(true);
    expect(canTransition("recovering", "cancelled")).toBe(true);
    expect(canTransition("resuming", "executing")).toBe(true);
    expect(canTransition("resuming", "recovering")).toBe(true);
    expect(canTransition("resuming", "failed")).toBe(true);
    expect(canTransition("resuming", "cancelled")).toBe(true);
    expect(canTransition("verifying", "completed")).toBe(true);
    expect(canTransition("verifying", "recovering")).toBe(true);
    expect(canTransition("verifying", "failed")).toBe(true);
    expect(canTransition("verifying", "cancelled")).toBe(true);
    expect(canTransition("failed", "resuming")).toBe(true);
    expect(canTransition("failed", "cancelled")).toBe(true);

    // Terminal states have no transitions
    expect(canTransition("completed", "executing")).toBe(false);
    expect(canTransition("completed", "failed")).toBe(false);
    expect(canTransition("cancelled", "executing")).toBe(false);
    expect(canTransition("cancelled", "planning")).toBe(false);

    // Invalid cross-transitions
    expect(canTransition("created", "executing")).toBe(false);
    expect(canTransition("created", "completed")).toBe(false);
    expect(canTransition("planning", "completed")).toBe(false);
    expect(canTransition("waiting_approval", "executing")).toBe(false);
    expect(canTransition("waiting_approval", "completed")).toBe(false);
    expect(canTransition("executing", "completed")).toBe(false);
    expect(canTransition("recovering", "completed")).toBe(false);
    expect(canTransition("resuming", "completed")).toBe(false);
    expect(canTransition("verifying", "executing")).toBe(false);
    expect(canTransition("verifying", "planning")).toBe(false);
  });

  it("makes cancellation reachable through the runtime", () => {
    const runtime = createTaskRuntimeService();
    const plan = runtime.create({ title: "cancel", steps: [{ action: "read", tool: "read_file", arguments: { path: "README.md" } }] });
    expect(runtime.cancel(plan.id)).toBe(true);
    expect(runtime.get(plan.id)?.state).toBe("cancelled");
    expect(runtime.cancel(plan.id)).toBe(false);
  });
});
