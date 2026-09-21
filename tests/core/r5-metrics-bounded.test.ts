import {describe,expect,it} from "vitest";
import {mcpMetrics} from "../../src/mcp/metrics.js";

describe("R5 MCP memory boundedness",()=>{
  it("keeps closed session records bounded while retaining lifetime counters",()=>{
    const before=mcpMetrics.getSnapshot();
    for(let i=0;i<2000;i++){
      const id="r5-metrics-bounded-"+i;
      mcpMetrics.recordSessionCreated(id);
      mcpMetrics.recordSessionClosed(id);
    }
    const after=mcpMetrics.getSnapshot();
    expect(after.sessions.total).toBe(before.sessions.total+2000);
    expect(after.sessions.active).toBe(before.sessions.active);
    expect((mcpMetrics as unknown as {sessions:Map<string,unknown>}).sessions.size).toBeLessThanOrEqual(512);
  });
});
