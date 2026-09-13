import { describe, expect, it } from "vitest";
import { executeShellCommand } from "../../src/services/shell/shell-service.js";
import { runWithPolicyApproval } from "../../src/core/governance/policy-decision-point.js";

describe("shell service", () => {
  it("executes a safe development command", async () => {
    const result = await executeShellCommand("node", ["--version"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
  });

  it("captures failed commands", async () => {
    // node <script> executes code — approval-gated; run as an approved step
    const result = await runWithPolicyApproval("execute_command", () =>
      executeShellCommand("node", ["command_that_does_not_exist.js"]));

    expect(result.exitCode).not.toBe(0);
  });

  it("blocks dangerous commands before execution", async () => {
    await expect(
      executeShellCommand("shutdown", ["/s"])
    ).rejects.toThrow();
  });

  it("does not interpret shell metacharacters", async () => {
    const result = await runWithPolicyApproval("execute_command", () =>
      executeShellCommand("node", ["tests/fixtures/echo-args.cjs", "literal & echo injected"]));
    expect(result.stdout).toBe("literal & echo injected");
  });

  it("requires approval for direct node script execution", async () => {
    // Direct (non-task) invocation of a code-executing command must be
    // rejected unless HOOSHIX_DIRECT_AUTO_APPROVE is enabled.
    await expect(
      executeShellCommand("node", ["tests/fixtures/echo-args.cjs"])
    ).rejects.toThrow(/Approval required/);
  });

  it("requires approval for cwd outside the active workspace", async () => {
    // Subprocess scope = active workspace; ".." is outside it.
    await expect(
      executeShellCommand("node", ["--version"], "..")
    ).rejects.toThrow(/Approval required/);
  });

  it("approved steps may run with cwd outside the active workspace", async () => {
    const result = await runWithPolicyApproval("execute_command", () =>
      executeShellCommand("node", ["--version"], ".."));
    expect(result.exitCode).toBe(0);
  });

  it("blocks recursive forced deletes in all variants", async () => {
    await expect(executeShellCommand("git", ["rm", "-rf", "/"])).rejects.toThrow();
    // `rm` is not in the executable allowlist at all — rejected by validateCommand
    await expect(executeShellCommand("rm", ["-r", "-f", "dir"])).rejects.toThrow();
  });
});
