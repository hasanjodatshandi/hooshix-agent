import { describe, expect, it } from "vitest";
import { evaluateCommandPermission, assertCommandPermission } from "../../src/security/permissions/command-permission.js";

describe("command permission policy", () => {
  it("allows low risk commands", () => {
    expect(evaluateCommandPermission("node", ["--version"]).decision).toBe("allow");
    expect(assertCommandPermission("node", ["--version"])).toBe(true);
  });

  it("requires approval for medium risk commands", () => {
    expect(evaluateCommandPermission("npm", ["install"]).decision).toBe("approval_required");
  });

  it("blocks dangerous commands", () => {
    expect(evaluateCommandPermission("node", ["shutdown", "/s"]).decision).toBe("blocked");
  });

  it("allows read-only GitHub Actions history queries", () => {
    // Actions history is read-only and same class as `pr list`, which was
    // already auto-allowed. The assistant needs these to answer workflow status
    // questions; gating them forced every query into approval and surfaced as
    // tool_handler_failure from the task runner.
    expect(evaluateCommandPermission("gh", ["run", "list"]).decision).toBe("allow");
    expect(evaluateCommandPermission("gh", ["run", "view"]).decision).toBe("allow");
    expect(evaluateCommandPermission("gh", ["run", "view", "123"]).decision).toBe("allow");
    expect(evaluateCommandPermission("gh", ["workflow", "list"]).decision).toBe("allow");
    expect(evaluateCommandPermission("gh", ["workflow", "view"]).decision).toBe("allow");
    expect(evaluateCommandPermission("gh", ["workflow", "view", "42"]).decision).toBe("allow");
  });

  it("still gates GitHub Actions mutations and flag-bearing forms", () => {
    // Mutations must never become auto-allowed by the run/workflow prefix.
    expect(evaluateCommandPermission("gh", ["run", "cancel", "123"]).decision).toBe("approval_required");
    expect(evaluateCommandPermission("gh", ["run", "rerun", "123"]).decision).toBe("approval_required");
    expect(evaluateCommandPermission("gh", ["run", "download", "123"]).decision).toBe("approval_required");
    expect(evaluateCommandPermission("gh", ["workflow", "enable", "ci.yml"]).decision).toBe("approval_required");
    expect(evaluateCommandPermission("gh", ["workflow", "disable", "ci.yml"]).decision).toBe("approval_required");
    // A flag would allow output-shaping / repo-relative filters; keep gated.
    expect(evaluateCommandPermission("gh", ["run", "list", "--workflow=ci.yml"]).decision).toBe("approval_required");
  });
});
