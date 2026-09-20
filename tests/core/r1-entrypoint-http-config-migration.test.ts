import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readLegacyRetentionDays } from "../../src/infrastructure/config/legacy-retention.js";
import { readLegacyHttpServerSettings, readLegacyHttpAccessToken } from "../../src/infrastructure/config/legacy-http-server.js";

describe("R1 entrypoint and HTTP environment isolation", () => {
  it("preserves startup retention numeric coercion and invalid-value skip semantics", () => {
    expect(readLegacyRetentionDays({})).toBe(90);
    expect(readLegacyRetentionDays({ HOOSHIX_RETENTION_DAYS: "7" })).toBe(7);
    expect(readLegacyRetentionDays({ HOOSHIX_RETENTION_DAYS: "0" })).toBe(0);
    expect(Number.isNaN(readLegacyRetentionDays({ HOOSHIX_RETENTION_DAYS: "invalid" }))).toBe(true);
  });

  it("preserves original HTTP port/public URL bootstrap values", () => {
    expect(readLegacyHttpServerSettings({})).toEqual({port:3001,publicBaseUrl:""});
    expect(readLegacyHttpServerSettings({ MCP_PORT: "3002", MCP_PUBLIC_BASE_URL: "https://example.invalid/" }))
      .toEqual({port:3002,publicBaseUrl:"https://example.invalid"});
    expect(Number.isNaN(readLegacyHttpServerSettings({ MCP_PORT: "invalid" }).port)).toBe(true);
    expect(readLegacyHttpServerSettings({ MCP_PORT: "0" }).port).toBe(0);
  });

  it("preserves token source precedence and lazy env reads without revealing a token", () => {
    expect(readLegacyHttpAccessToken({})).toBeUndefined();
    expect(readLegacyHttpAccessToken({ MCP_ACCESS_TOKEN: "fixture-token" })).toBe("fixture-token");
    expect(readLegacyHttpAccessToken({ MCP_ACCESS_TOKEN: "" })).toBe("");
    expect(readLegacyHttpAccessToken({ MCP_ACCESS_TOKEN: "new" })).toBe("new");
  });

  it("all environment reads are restricted to config/bootstrap across the entire TypeScript source tree", () => {
    const visit = (directory: string): string[] => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const location = path.join(directory, entry.name);
      return entry.isDirectory() ? visit(location) : entry.isFile() && /\.tsx?$/.test(entry.name) ? [location] : [];
    });
    const offenders = visit(path.resolve("src")).filter(file => {
      const source = file.replace(/\\/g, "/");
      return !source.includes("/infrastructure/config/") && !source.includes("/bootstrap/") &&
        /\bprocess\s*\.\s*env\b/.test(fs.readFileSync(file, "utf8"));
    });
    expect(offenders).toEqual([]);
  });
});
