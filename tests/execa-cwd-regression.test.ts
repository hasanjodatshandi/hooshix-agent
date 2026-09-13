import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gitStatus } from "../src/services/git/git-service.js";
import { executeShellCommand } from "../src/services/shell/shell-service.js";
import { runWithPolicyApproval } from "../src/core/governance/policy-decision-point.js";
import { setUnrestrictedMode, isUnrestrictedMode } from "../src/security/workspace-guard.js";

/**
 * Regression tests for the "git exited with code undefined" failure class.
 *
 * Production path (Stage RA-7, 2026-09-06): a task step ran execute_command
 * git with a non-existent cwd. execa + reject:false resolves with
 * exitCode: undefined and empty stderr on spawn failure, which surfaced as
 * the meaningless "git exited with code undefined". These tests pin the fixed
 * behavior: an explicit "does not exist" error naming the path.
 */
describe("missing cwd produces accurate errors", () => {
  const missing = path.join(os.tmpdir(), "hooshix-missing-cwd-does-not-exist");

  afterEach(() => {
    setUnrestrictedMode(false);
  });

  it("shell execution fails with an explicit missing-directory error", async () => {
    // execute_command resolves cwd via path.resolve (no workspace guard), so
    // this is the exact production path that produced exitCode undefined.
    await expect(
      runWithPolicyApproval("execute_command", () =>
        executeShellCommand("git", ["status"], missing))
    ).rejects.toThrow(/does not exist/i);
  });

  it("git_status under unrestricted mode fails with an explicit missing-directory error", async () => {
    const was = isUnrestrictedMode();
    runWithPolicyApproval("set_workspace", async () => {
      setUnrestrictedMode(true);
    });
    try {
      await expect(gitStatus(missing)).rejects.toThrow(/Git working directory does not exist/);
      await expect(gitStatus(missing)).rejects.toThrow(/hooshix-missing-cwd-does-not-exist/);
    } finally {
      setUnrestrictedMode(was);
    }
  });

  it("shell failure no longer mentions 'exited with code undefined'", async () => {
    await expect(
      runWithPolicyApproval("execute_command", () =>
        executeShellCommand("git", ["status"], missing))
    ).rejects.not.toThrow(/exited with code undefined/);
  });
});
