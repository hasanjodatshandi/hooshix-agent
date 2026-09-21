import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readLegacyRetentionDays } from "../../src/infrastructure/config/legacy-retention.js";
import { readLegacyHttpServerSettings, readLegacyHttpAccessToken, readHttpBootstrapSecret } from "../../src/infrastructure/config/legacy-http-server.js";

describe("R1 entrypoint and HTTP environment isolation", () => {
  it("preserves startup retention numeric coercion and invalid-value skip semantics", () => {
    expect(readLegacyRetentionDays({})).toBe(90);
    expect(readLegacyRetentionDays({ HOOSHIX_RETENTION_DAYS: "7" })).toBe(7);
    expect(readLegacyRetentionDays({ HOOSHIX_RETENTION_DAYS: "0" })).toBe(0);
    expect(Number.isNaN(readLegacyRetentionDays({ HOOSHIX_RETENTION_DAYS: "invalid" }))).toBe(true);
  });

  it("uses an explicit trusted HTTP resource and fails closed for external binds",()=>{
    expect(readLegacyHttpServerSettings({})).toEqual({port:3001,publicBaseUrl:"http://127.0.0.1:3001"});
    expect(readLegacyHttpServerSettings({MCP_PORT:"3002",MCP_PUBLIC_BASE_URL:"https://example.invalid/"}))
      .toEqual({port:3002,publicBaseUrl:"https://example.invalid"});
    expect(()=>readLegacyHttpServerSettings({MCP_PORT:"invalid"})).toThrow(/MCP_PORT/);
    expect(()=>readLegacyHttpServerSettings({MCP_BIND_HOST:"0.0.0.0"})).toThrow(/PUBLIC_BASE_URL/);
  });
  it("refuses legacy transport bearer variables instead of promoting them into operator authority",()=>{
    expect(readLegacyHttpAccessToken({})).toBeUndefined();
    expect(readLegacyHttpAccessToken({MCP_ACCESS_TOKEN:"fixture-token"})).toBeUndefined();
    expect(()=>readHttpBootstrapSecret({MCP_ACCESS_TOKEN:"fixture-token"})).toThrow(/deprecated/);
    expect(()=>readHttpBootstrapSecret({MCP_API_KEY:"fixture-token"})).toThrow(/unsupported/);
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