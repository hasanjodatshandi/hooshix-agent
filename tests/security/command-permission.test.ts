import { describe, expect, it } from "vitest";
import { evaluateCommandPermission, assertCommandPermission } from "../../src/security/permissions/command-permission.js";

describe("command permission policy", () => {
  it("allows low risk commands", () => {
    expect(evaluateCommandPermission("node", ["--version"]).decision).toBe("allow");
    expect(assertCommandPermission("node", ["--version"])).toBe(true);
  });

  it("requires approval for medium risk commands", () => {
    expect(evaluateCommandPermission("npm", ["install"]).decision).toBe("approval_required");
  });

  it("blocks dangerous commands", () => {
    expect(evaluateCommandPermission("node", ["shutdown", "/s"]).decision).toBe("blocked");
  });
});
