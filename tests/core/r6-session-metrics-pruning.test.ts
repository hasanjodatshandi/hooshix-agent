import {describe,expect,it} from "vitest";
import {McpMetrics} from "../../src/mcp/metrics.js";

describe("R6.06 bounded MCP session metrics",()=>{
  it("immediately discards closed session identifiers but preserves lifetime and peak counters",()=>{
    const metrics=new McpMetrics();
    const records=()=> (metrics as unknown as {sessions:Map<string,unknown>}).sessions;
    metrics.recordSessionCreated("active-one","client-A");
    metrics.recordSessionCreated("active-two","client-B");
    metrics.recordSessionCreated("active-one","duplicate");
    expect(metrics.getSnapshot().sessions).toEqual({total:2,active:2,peakConcurrent:2});
    for(let i=0;i<10_000;i++){
      const id="closed-session-"+i;
      metrics.recordSessionCreated(id,"churn-client-"+i);
      metrics.recordToolCall("read_file",i%500,true,id);
      metrics.recordSessionClosed(id);
      metrics.recordSessionClosed(id);
      if(i%1000===0)expect(records().size).toBe(2);
    }
    expect(records().size).toBe(2);
    expect([...records().keys()].sort()).toEqual(["active-one","active-two"]);
    expect(metrics.getSnapshot().sessions).toEqual({total:10_002,active:2,peakConcurrent:3});
    metrics.recordSessionClosed("active-one");
    metrics.recordSessionClosed("active-two");
    expect(records().size).toBe(0);
    expect(metrics.getSnapshot().sessions).toEqual({total:10_002,active:0,peakConcurrent:3});
    metrics.recordSessionClosed("never-seen");
    expect(metrics.getSnapshot().sessions.total).toBe(10_002);
  });
});
