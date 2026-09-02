import { describe, expect, it } from "vitest";
import { executeShellCommand } from "../../src/services/shell/shell-service.js";

describe("shell timeout handling", () => {
  it("stops commands that exceed timeout", async () => {
    await expect(
      executeShellCommand(
        "node",
        ["tests/fixtures/slow-process.cjs"],
        ".",
        100
      )
    ).rejects.toThrow();
  }, 10000);
});
