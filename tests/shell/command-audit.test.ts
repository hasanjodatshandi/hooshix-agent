import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { logCommandAction } from "../../src/memory/command-audit.js";

describe("command audit logger", () => {
  it("stores executed command information", async () => {
    await logCommandAction({
      command: "node",
      args: ["--version"],
      exitCode: 0,
      status: "success",
      correlationId: "command-audit-test"
    });

    const log = await fs.readFile(
      path.join(process.env.HOOSHIX_LOG_DIR!, "command-actions.log"),
      "utf8"
    );

    expect(log).toContain("command-audit-test");
  });

  it("redacts secret argument values", async () => {
    await logCommandAction({
      command: "node",
      args: ["script.js", "--token", "super-secret-value"],
      status: "success",
      correlationId: "redaction-test"
    });
    const log = await fs.readFile(path.join(process.env.HOOSHIX_LOG_DIR!, "command-actions.log"), "utf8");
    expect(log).not.toContain("super-secret-value");
    expect(log).toContain("[REDACTED]");
  });
});
