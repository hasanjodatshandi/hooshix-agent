import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  replaceWorkspaceRoots,
  classifyCommandCwd,
  validateCommandCwd,
} from "../src/security/workspace-guard.js";
import { policyDecisionPoint } from "../src/core/governance/policy-decision-point.js";
import { checkStepGovernance } from "../src/core/governance/step-governance.js";
import { createLocalToolExecutor } from "../src/core/executor/local-tool-executor.js";

// Regression tests for the task_run → execute_command workspace-isolation
// bypass: the task loop and task_step_risks must classify a cwd OUTSIDE the
// active workspace as approval_required BEFORE execution, and the executor
// must NOT auto-satisfy the cwd escalation gate mid-run.

const ws = fs.mkdtempSync(path.join(os.tmpdir(), "hx-taskcwd-ws-"));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), "hx-taskcwd-out-"));

beforeEach(() => {
  replaceWorkspaceRoots(ws);
});

afterEach(() => {
  replaceWorkspaceRoots(path.resolve("."));
});

describe("classifyCommandCwd (shared governance/enforcement predicate)", () => {
  it("classifies the active workspace as inside", () => {
    expect(classifyCommandCwd(ws).inside).toBe(true);
  });

  it("classifies outside paths as outside", () => {
    expect(classifyCommandCwd(outside).inside).toBe(false);
    expect(classifyCommandCwd(os.tmpdir()).inside).toBe(false);
  });

  it("classifies nonexistent paths as outside (fail-closed)", () => {
    expect(classifyCommandCwd(path.join(ws, "nope-xyz")).inside).toBe(false);
  });

  it("canonicalizes traversal attempts before classifying", () => {
    const parent = path.dirname(ws);
    expect(classifyCommandCwd(path.join(ws, "..", path.basename(outside))).inside).toBe(false);
    expect(classifyCommandCwd(path.join(ws, "..", path.basename(ws))).inside).toBe(true);
    void parent;
  });
});

describe("PDP: execute_command cwd classification (pre-execution)", () => {
  it("requires approval when cwd is outside the active workspace", () => {
    const decision = policyDecisionPoint.evaluate({
      tool: "execute_command",
      arguments: { command: "git", args: ["status"], cwd: outside },
    });
    expect(decision.allowed).toBe(true);
    expect(decision.requiresApproval).toBe(true);
    expect(decision.reason).toMatch(/outside the active workspace/);
  });

  it("does not require approval for inside cwd read-only commands", () => {
    const decision = policyDecisionPoint.evaluate({
      tool: "execute_command",
      arguments: { command: "git", args: ["status"], cwd: ws },
    });
    expect(decision.allowed).toBe(true);
    expect(decision.requiresApproval).toBe(false);
  });

  it("still applies command permission on top of the cwd gate", () => {
    const decision = policyDecisionPoint.evaluate({
      tool: "execute_command",
      arguments: { command: "git", args: ["push"], cwd: ws },
    });
    expect(decision.allowed).toBe(true);
    expect(decision.requiresApproval).toBe(true);
  });
});

describe("checkStepGovernance: task_step_risks consistency", () => {
  it("explicit outside cwd → approval_required (the reported inconsistency)", () => {
    const gov = checkStepGovernance({
      id: 1, action: "git status", tool: "execute_command",
      arguments: { command: "git", args: ["status", "--short"], cwd: outside },
      status: "pending",
    });
    expect(gov.decision).toBe("approval_required");
    expect(gov.risk).toBe("high");
    expect(gov.reason).toMatch(/outside the active workspace/);
  });

  it("inside cwd read-only step → allow", () => {
    const gov = checkStepGovernance({
      id: 1, action: "git status", tool: "execute_command",
      arguments: { command: "git", args: ["status"] },
      status: "pending",
    }, ws);
    expect(gov.decision).toBe("allow");
  });

  it("omitted cwd is classified against the task's effective workspace", () => {
    // Task workspace outside the ACTIVE workspace → must pause for approval
    const gov = checkStepGovernance({
      id: 1, action: "git status", tool: "execute_command",
      arguments: { command: "git", args: ["status"] },
      status: "pending",
    }, outside);
    expect(gov.decision).toBe("approval_required");
  });

  it("git -C escape into an outside repo is caught via cwd classification", () => {
    // cwd is inside, but the SAME classification applies to the effective
    // directory; the direct -C argument is governed by command permission
    // (approval_required), verified here as the composed posture.
    const gov = checkStepGovernance({
      id: 1, action: "git status", tool: "execute_command",
      arguments: { command: "git", args: ["-C", outside, "status"], cwd: ws },
      status: "pending",
    }, ws);
    expect(gov.decision).toBe("approval_required");
  });
});

describe("executor no longer auto-satisfies the cwd escalation", () => {
  it("task-path execute_command with outside cwd is rejected without approval context", async () => {
    const executor = createLocalToolExecutor("corr-test-1", undefined, { workspace: ws, roots: [ws], unrestricted: false });
    await expect(executor("execute_command", {
      id: 1, action: "git status", tool: "execute_command",
      arguments: { command: "git", args: ["status"], cwd: outside },
      status: "pending",
    })).rejects.toThrow(/Approval required/);
  });

  it("approved task steps still pass the cwd escalation", async () => {
    const { runWithPolicyApproval } = await import("../src/core/governance/policy-decision-point.js");
    const executor = createLocalToolExecutor("corr-test-2", undefined, { workspace: ws, roots: [ws], unrestricted: false });
    const result = await runWithPolicyApproval("execute_command", () =>
      executor("execute_command", {
        id: 1, action: "echo probe", tool: "execute_command",
        arguments: { command: "node", args: ["-e", "console.log('cwd-ok')"], cwd: outside },
        status: "pending",
      })
    );
    expect((result as { stdout?: string }).stdout).toContain("cwd-ok");
  });

  it("inside-cwd auto-allowed task steps run normally (no approval context needed)", async () => {
    const executor = createLocalToolExecutor("corr-test-3", undefined, { workspace: ws, roots: [ws], unrestricted: false });
    const result = await executor("execute_command", {
      id: 1, action: "git version", tool: "execute_command",
      arguments: { command: "git", args: ["--version"] },
      status: "pending",
    });
    expect((result as { stdout?: string }).stdout).toContain("git version");
  });

  it("inside-cwd code execution (node -e) still requires approval in the task path", async () => {
    const executor = createLocalToolExecutor("corr-test-4", undefined, { workspace: ws, roots: [ws], unrestricted: false });
    await expect(executor("execute_command", {
      id: 2, action: "run inline code", tool: "execute_command",
      arguments: { command: "node", args: ["-e", "console.log('x')"] },
      status: "pending",
    })).rejects.toThrow(/Approval required/);
  });
});

describe("validateCommandCwd enforcement unchanged", () => {
  it("outside cwd still throws for direct calls", () => {
    expect(() => validateCommandCwd(outside)).toThrow(/Approval required/);
  });
});
