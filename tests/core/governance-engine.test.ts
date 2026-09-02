import { describe, expect, it } from "vitest";
import { evaluateAction } from "../../src/core/governance/governance-engine.js";

describe("governance engine", () => {
  it("requires approval for destructive actions", () => {
    expect(evaluateAction("delete project file").decision)
      .toBe("approval_required");
  });

  it("requires approval for admin operations", () => {
    expect(evaluateAction("install software as admin").risk)
      .toBe("critical");
  });

  it("allows normal development actions", () => {
    expect(evaluateAction("read source file").decision)
      .toBe("allow");
  });
});
