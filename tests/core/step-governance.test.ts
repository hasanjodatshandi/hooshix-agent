import { describe, expect, it } from "vitest";
import { checkStepGovernance } from "../../src/core/governance/step-governance.js";

describe("step governance", () => {
  it("evaluates before execution", () => {
    expect(checkStepGovernance("delete file").decision)
      .toBe("approval_required");
  });

  it("uses the typed tool as the security authority", () => {
    expect(checkStepGovernance({ id: 1, action: "harmless label", tool: "delete_file", status: "pending" }).decision)
      .toBe("approval_required");
    expect(checkStepGovernance({ id: 2, action: "harmless label", tool: "install_package", status: "pending" }).decision)
      .toBe("approval_required");
    expect(checkStepGovernance({ id: 3, action: "read deletion guide", tool: "read_file", status: "pending" }).decision)
      .toBe("allow");
  });
});
