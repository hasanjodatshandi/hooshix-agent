import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { listWorkspaceDirectory } from "../src/services/filesystem/filesystem-service.js";

describe("filesystem list service", () => {
  it("distinguishes files and directories", async () => {
    const root = "tests/runtime-files/list";
    await fs.mkdir(`${root}/folder`, { recursive: true });
    await fs.writeFile(`${root}/file.txt`, "ok");
    try {
      expect((await listWorkspaceDirectory(root, "list-test")).sort()).toEqual([
        "[DIR] folder", "[FILE] file.txt"
      ]);
    } finally {
      await fs.rm("tests/runtime-files", { recursive: true, force: true });
    }
  });
});
