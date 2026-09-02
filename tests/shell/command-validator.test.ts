import { describe, expect, it } from "vitest";
import { validateCommand } from "../../src/security/command-validator.js";

describe("command validator", () => {
  it("allows development commands", () => {
    expect(validateCommand("node", ["--version"])).toBe(true);
  });

  it("blocks dangerous commands", () => {
    expect(() => validateCommand("shutdown", ["/s"])).toThrow();
  });
});
