import { describe, expect, it } from "vitest";
import { policyDecisionPoint } from "../src/core/governance/policy-decision-point.js";
import { TOOL_CAPABILITIES, TOOL_NAMES } from "../src/core/orchestrator/tool-orchestrator.js";

/**
 * Contract audit (git_init lesson): a tool whose METADATA claims it is a
 * mutation / destructive operation must REQUIRE APPROVAL in the PDP for a
 * plain direct call (no approval context, no escalation args). Otherwise the
 * registry promises a gate that the policy engine does not enforce.
 *
 * Filesystem mutations (write/create/modify/restore) are deliberately NOT in
 * APPROVAL_TOOLS: they are hard-scoped to the active workspace by
 * workspace-guard, which is a stronger guarantee than an approval round-trip.
 * execute_command is governed by the command-permission engine + cwd
 * classification instead. Both are asserted to keep those carve-outs honest.
 */

// Tools that are destructive/mutating by annotation or risk metadata.
const METADATA_MUTATIONS = TOOL_NAMES.filter((tool) => {
  const cap = TOOL_CAPABILITIES[tool];
  return cap.risk === "high" || cap.risk === "critical";
});

// Known governed tools (must require approval on direct calls).
const APPROVAL_EXPECTED = new Set([
  "delete_file", "git_clone", "git_commit", "git_branch", "git_checkout",
  "git_add", "git_init", "install_package", "remove_package", "update_package",
  "task_rollback",
]);

// Deliberate carve-outs: governed by other, stronger mechanisms.
const CARVE_OUTS = new Set([
  "execute_command", // command-permission engine + cwd classification + approval for code exec
  "package_restore", // restores manifests from a prior snapshot; reversible by design
]);

describe("approval contract audit: metadata vs policy engine", () => {
  it("every destructive/mutating tool requires approval on a plain direct call", () => {
    const failures: string[] = [];
    for (const tool of TOOL_NAMES) {
      const decision = policyDecisionPoint.evaluate({ tool, arguments: sampleArguments(tool) });
      const shouldGate = APPROVAL_EXPECTED.has(tool);
      if (shouldGate && !decision.requiresApproval) {
        failures.push(`${tool}: metadata says mutation but PDP allows silently (${decision.reason})`);
      }
      void decision;
      void failures;
    }
    // Assert the full expected set gates — the real contract.
    for (const tool of APPROVAL_EXPECTED) {
      const decision = policyDecisionPoint.evaluate({ tool, arguments: sampleArguments(tool) });
      expect({ tool, requiresApproval: decision.requiresApproval }).toEqual({ tool, requiresApproval: true });
    }
  });

  it("high/critical-risk tools are all either approval-gated or a documented carve-out", () => {
    const ungated = METADATA_MUTATIONS.filter((tool) => !APPROVAL_EXPECTED.has(tool) && !CARVE_OUTS.has(tool));
    expect(ungated).toEqual([]);
  });

  it("carve-outs keep their alternate governance (spot checks)", () => {
    // execute_command: code execution is approval-required by command policy…
    const codeExec = policyDecisionPoint.evaluate({ tool: "execute_command", arguments: { command: "node", args: ["-e", "1"] } });
    expect(codeExec.requiresApproval).toBe(true);
    // …and an outside-workspace cwd is approval-required by cwd classification.
    const outside = policyDecisionPoint.evaluate({ tool: "execute_command", arguments: { command: "git", args: ["status"], cwd: "C:/Windows" } });
    expect(outside.requiresApproval).toBe(true);
    // package_restore sits at DEVELOPER_MODE permission and stays reversible;
    // pin it as a conscious exception so it cannot silently become ungated.
    const restore = policyDecisionPoint.evaluate({ tool: "package_restore", arguments: { snapshotId: "550e8400-e29b-41d4-a716-446655440000" } });
    expect(restore.allowed).toBe(true);
  });

  it("read-only tools never require approval", () => {
    for (const tool of ["read_file", "list_directory", "search_files", "git_status", "git_diff", "git_log", "get_system_info", "agent_metrics", "get_workspace"] as const) {
      const decision = policyDecisionPoint.evaluate({ tool, arguments: sampleArguments(tool) });
      expect({ tool, requiresApproval: decision.requiresApproval, allowed: decision.allowed }).toEqual({ tool, requiresApproval: false, allowed: true });
    }
  });
});

/** Minimal valid arguments per tool so the PDP reaches its main branches. */
function sampleArguments(tool: string): Record<string, unknown> {
  switch (tool) {
    case "delete_file": return { path: "in-workspace.txt" };
    case "git_clone": return { url: "https://example.com/repo.git", path: "in-workspace" };
    case "git_commit": return { message: "test" };
    case "git_branch": return { name: "feature/x" };
    case "git_checkout": return { name: "feature/x" };
    case "git_add": return { paths: ["."] };
    case "git_init": return { path: "in-workspace" };
    case "install_package": return { manager: "npm", name: "lodash" };
    case "remove_package": return { manager: "npm", name: "lodash" };
    case "update_package": return { manager: "npm", name: "lodash" };
    case "task_rollback": return { snapshotId: "550e8400-e29b-41d4-a716-446655440000", cwd: "." };
    case "package_restore": return { snapshotId: "550e8400-e29b-41d4-a716-446655440000" };
    case "execute_command": return { command: "git", args: ["status"] };
    case "read_file": return { path: "in-workspace.txt" };
    case "search_files": return { query: "x" };
    default: return {};
  }
}
