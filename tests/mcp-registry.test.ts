import { describe, expect, it } from "vitest";
import { registerTools } from "../src/mcp/registry.js";

describe("MCP tool registry", () => {
  it("loads registered tools using current MCP registerTool API", () => {
    const registered: string[] = [];

    const server = {
      registerTool: (name: string) => {
        registered.push(name);
      }
    } as any;

    registerTools(server);

    expect(registered.length).toBeGreaterThan(0);
    expect(registered).toContain("get_system_info");
    expect(registered).toContain("execute_command");
  });
});
