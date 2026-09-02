import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { searchWorkspaceFiles } from "../src/services/filesystem/filesystem-service.js";

describe("search files service", () => {
  it("returns relative matching files and skips node_modules", async () => {
    const root = "tests/runtime-files/search";
    await fs.mkdir(`${root}/node_modules/ignored`, { recursive: true });
    await fs.writeFile(`${root}/match.txt`, "unique-search-value");
    await fs.writeFile(`${root}/node_modules/ignored/match.txt`, "unique-search-value");
    try {
      expect(await searchWorkspaceFiles(root, "unique-search-value", "search-test")).toEqual([
        path.join("tests", "runtime-files", "search", "match.txt")
      ]);
    } finally {
      await fs.rm("tests/runtime-files", { recursive: true, force: true });
    }
  });
});
