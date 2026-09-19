import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readLegacyWorkspaceBootstrapSettings } from "../../src/infrastructure/config/legacy-workspace-bootstrap.js";

describe("R1 legacy workspace bootstrap config relocation", () => {
  it("preserves the original CSV trimming and strict unrestricted flag semantics", () => {
    expect(readLegacyWorkspaceBootstrapSettings({})).toEqual({
      rootsCsv: "", unrestrictedBootOptIn: false,
    });
    expect(readLegacyWorkspaceBootstrapSettings({
      HOOSHIX_WORKSPACE: "  C:/fixture-a, D:/fixture-b  ", HOOSHIX_UNRESTRICTED: "1",
    })).toEqual({
      rootsCsv: "C:/fixture-a, D:/fixture-b", unrestrictedBootOptIn: true,
    });
    expect(readLegacyWorkspaceBootstrapSettings({ HOOSHIX_UNRESTRICTED: "true" }).unrestrictedBootOptIn).toBe(true);
    for (const value of ["TRUE", "yes", "0", "false", ""]) {
      expect(readLegacyWorkspaceBootstrapSettings({ HOOSHIX_UNRESTRICTED: value }).unrestrictedBootOptIn).toBe(false);
    }
  });
  it("isolates environment reads in infrastructure while leaving the legacy guard policy unchanged", () => {
    const source = fs.readFileSync(path.resolve("src/security/workspace-guard.ts"), "utf8");
    expect(source).toContain("readLegacyWorkspaceBootstrapSettings()");
    expect(source).not.toMatch(/\bprocess\s*\.\s*env\b/);
  });
});
