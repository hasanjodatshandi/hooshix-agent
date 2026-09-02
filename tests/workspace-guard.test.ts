import { describe, expect, it } from "vitest";
import { validateWorkspace } from "../src/security/workspace-guard.js";
import fs from "node:fs";
import os from "node:os";

describe("workspace guard", () => {
  it("allows workspace files", () => {
    expect(validateWorkspace("package.json")).toContain("package.json");
  });

  it("blocks paths outside workspace", () => {
    expect(() => validateWorkspace("../outside.txt")).toThrow();
  });

  it("blocks junctions that point outside workspace", () => {
    const link = "tests/runtime-workspace-link";
    fs.rmSync(link, { force: true, recursive: true });
    fs.symlinkSync(os.tmpdir(), link, "junction");
    try {
      expect(() => validateWorkspace(`${link}/outside.txt`)).toThrow();
    } finally {
      fs.rmSync(link, { force: true });
    }
  });
});
