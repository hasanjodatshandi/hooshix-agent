import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { searchWorkspaceFiles } from "../src/services/filesystem/filesystem-service.js";

describe("search files service", () => {
  it("returns relative matching files and skips node_modules", async () => {
    const root = "tests/runtime-files/search";
    await fs.mkdir(`${root}/node_modules/ignored`, { recursive: true });
    await fs.writeFile(`${root}/match.txt`, "unique-search-value");
    await fs.writeFile(`${root}/node_modules/ignored/match.txt`, "unique-search-value");
    try {
      const result = await searchWorkspaceFiles(root, "unique-search-value", "search-test");
      expect(result.query).toBe("unique-search-value");
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].path).toBe("match.txt");
      expect(result.matches[0].line).toBe(1);
      expect(result.matches[0].text).toBe("unique-search-value");
      expect(result.truncated).toBe(false);
    } finally {
      await fs.rm("tests/runtime-files", { recursive: true, force: true });
    }
  });
});
