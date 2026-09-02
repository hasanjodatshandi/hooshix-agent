import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { logFileAction } from "../src/memory/file-audit.js";

describe("file audit logger", () => {
  it("writes actions into audit log", async () => {
    await logFileAction("test", "tests/sample.txt", "file-audit-test");
    const content = await fs.readFile(path.join(process.env.HOOSHIX_LOG_DIR!, "file-actions.log"), "utf8");
    expect(content).toContain("sample.txt");
  });
});
