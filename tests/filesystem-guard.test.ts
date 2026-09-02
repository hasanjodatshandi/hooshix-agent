import { describe, expect, it } from "vitest";
import { validateWorkspace } from "../src/security/workspace-guard.js";

describe("filesystem security boundary", () => {
  it("allows internal paths", () => {
    expect(validateWorkspace("src/index.ts")).toContain("src");
  });

  it("rejects traversal", () => {
    expect(() => validateWorkspace("../../Windows/System32")).toThrow();
  });
});
