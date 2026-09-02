import { describe, expect, it } from "vitest";
import { executeShellCommand } from "../../src/services/shell/shell-service.js";

describe("shell service", () => {
  it("executes a safe development command", async () => {
    const result = await executeShellCommand("node", ["--version"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
  });

  it("captures failed commands", async () => {
    const result = await executeShellCommand("node", ["command_that_does_not_exist.js"]);

    expect(result.exitCode).not.toBe(0);
  });

  it("blocks dangerous commands before execution", async () => {
    await expect(
      executeShellCommand("shutdown", ["/s"])
    ).rejects.toThrow();
  });

  it("does not interpret shell metacharacters", async () => {
    const result = await executeShellCommand("node", ["tests/fixtures/echo-args.cjs", "literal & echo injected"]);
    expect(result.stdout).toBe("literal & echo injected");
  });

  it("rejects working directories outside the workspace", async () => {
    await expect(executeShellCommand("node", ["--version"], "..")).rejects.toThrow("outside workspace");
  });
});
