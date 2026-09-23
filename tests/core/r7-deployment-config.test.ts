import fs from "node:fs";
import path from "node:path";
import {describe,expect,it} from "vitest";
import {loadAppConfig} from "../../src/infrastructure/config/app-config.js";

describe("R7 deployment/config contracts",()=>{
  it("rejects stale MCP_API_KEY with explicit migration error",()=>{
    expect(()=>loadAppConfig({MCP_API_KEY:"legacy"},"C:/fixture")).toThrow(/MCP_API_KEY is unsupported/);
  });
  it("uses canonical bootstrap token file without scattered runtime env reads",()=>{
    const cfg=loadAppConfig({HOOSHIX_BOOTSTRAP_TOKEN_FILE:"C:/fixture/secret.token"},"C:/fixture");
    expect(cfg.bootstrapTokenFile).toBe("C:/fixture/secret.token");
  });
  it("Docker is frozen, non-root, canonical and probes liveness",()=>{
    const docker=fs.readFileSync(path.resolve("Dockerfile"),"utf8");
    expect(docker).not.toMatch(/\|\|\s*pnpm install/);
    expect(docker).toContain("USER node");
    expect(docker).toContain("/health/live");
    expect(docker).not.toContain("MCP_API_KEY");
    expect(docker).toContain("HOOSHIX_HTTP_PORT=3001");
  });
  it("http server has no direct process.env read",()=>{
    const http=fs.readFileSync(path.resolve("src/mcp/http-server.ts"),"utf8");
    expect(http).not.toContain("process.env");
  });
});
