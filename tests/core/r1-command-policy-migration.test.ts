import { describe, expect, it } from "vitest";
import * as oldValidator from "../../src/security/command-validator.js";
import * as oldCommand from "../../src/security/permissions/command-permission.js";
import * as oldGovernance from "../../src/core/governance/governance-engine.js";
import * as commandPolicy from "../../src/application/services/legacy-command-policy.js";
import * as actionPolicy from "../../src/application/services/legacy-action-governance.js";

describe("R1 pure command/governance migration", () => {
  it("keeps legacy command exports as exact aliases", () => {
    expect(oldValidator.validateCommand).toBe(commandPolicy.validateCommand);
    expect(oldCommand.validateCommand).toBe(commandPolicy.validateCommand);
    expect(oldCommand.evaluateCommandPermission).toBe(commandPolicy.evaluateCommandPermission);
    expect(oldCommand.assertCommandPermission).toBe(commandPolicy.assertCommandPermission);
  });

  it("keeps legacy action-governance exports as exact aliases", () => {
    expect(oldGovernance.evaluateAction).toBe(actionPolicy.evaluateAction);
    expect(oldGovernance.assertGovernance).toBe(actionPolicy.assertGovernance);
  });

  it("uses the single corrected R2 command authorization policy through legacy aliases", () => {
    expect(commandPolicy.evaluateCommandPermission("git", ["diff", "--no-index", "a", "b"]))
      .toEqual({ risk: "high", decision: "blocked" });
  });
});
