import fs from "node:fs/promises";
import path from "node:path";
import {describe,expect,it,vi} from "vitest";
import {logCommandAction} from "../../src/memory/command-audit.js";
import {bestEffortTelemetry,telemetryDegradationCount}
  from "../../src/core/trace/telemetry-degradation.js";
import {McpMetrics} from "../../src/mcp/metrics.js";
import {createDisposableFixture} from "../helpers/r0-disposable-fixtures.js";

describe("R6.09 command audit and degraded telemetry",()=>{
  it("redacts separated and inline opaque tokens, headers, environment values and arbitrary extra fields",async()=>{
    const fixture=createDisposableFixture("r6-audit-redact");
    const former=process.env.HOOSHIX_LOG_DIR;
    const opaque="r6-opaque-934175",inline="r6-inline-943157",
      envValue="r6-env-value-951137",header="r6-header-value-328174",
      password="r6-password-value-782365";
    try{
      process.env.HOOSHIX_LOG_DIR=fixture.root;
      await logCommandAction({
        command:"git",cwd:fixture.root,correlationId:"r6-redaction",
        status:"blocked",exitCode:1,
        args:["diff","--token",opaque,"--api-key="+inline,
          "--env","BENIGN="+envValue,"--header","Authorization: Bearer "+header,
          "--password",password,"--normal-option","benign"],
        env:{BENIGN:envValue,ACCESS_TOKEN:opaque}
      });
      const log=await fs.readFile(path.join(fixture.root,"command-actions.log"),"utf8");
      const entry=JSON.parse(log.trim()) as Record<string,unknown>;
      expect(entry.args).toEqual(["diff","--token","[REDACTED]","--api-key=[REDACTED]",
        "--env","[REDACTED]","--header","[REDACTED]","--password","[REDACTED]",
        "--normal-option","benign"]);
      expect(entry.environment).toBe("[REDACTED]");
      expect(entry.env).toBeUndefined();
      expect(entry.correlationId).toBe("r6-redaction");
      for(const value of [opaque,inline,envValue,header,password])
        expect(log).not.toContain(value);
      expect(log).toContain("[REDACTED]");
    }finally{
      if(former===undefined)delete process.env.HOOSHIX_LOG_DIR;
      else process.env.HOOSHIX_LOG_DIR=former;
      fixture.cleanup();
    }
  });

  it("exposes a monotonic non-sensitive degradation counter and preserves successful effects when diagnostic stderr throws",()=>{
    const metrics=new McpMetrics();
    const before=telemetryDegradationCount();
    const dangerous="r6-opaque-unlogged-sink-error";
    const spy=vi.spyOn(console,"error").mockImplementation(()=>{throw Error("diagnostic stream failed");});
    try{
      expect(()=>bestEffortTelemetry(()=>{throw new Error(dangerous);})).not.toThrow();
    }finally{spy.mockRestore();}
    const after=telemetryDegradationCount();
    expect(after).toBe(before+1);
    const exposition=metrics.getPrometheusMetrics();
    expect(exposition).toContain("# HELP hooshix_telemetry_degraded_total Lifetime best-effort telemetry sink failures");
    expect(exposition).toContain("# TYPE hooshix_telemetry_degraded_total counter");
    expect(exposition).toContain("hooshix_telemetry_degraded_total "+after+"\n");
    expect(exposition).not.toContain(dangerous);
  });
});
