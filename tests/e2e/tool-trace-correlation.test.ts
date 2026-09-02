import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { logFileAction } from "../../src/memory/file-audit.js";

describe("tool trace correlation", () => {
  it("writes correlation id into file audit trace", async () => {
    await logFileAction("read", "trace-test.txt", "corr-e2e-1");

    const log = await fs.readFile(path.join(process.env.HOOSHIX_LOG_DIR!, "file-actions.log"), "utf8");

    expect(log).toContain("corr-e2e-1");
  });
});
