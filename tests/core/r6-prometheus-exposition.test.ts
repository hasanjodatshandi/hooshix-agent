import {spawnSync} from "node:child_process";
import {describe,expect,it} from "vitest";
import {McpMetrics} from "../../src/mcp/metrics.js";

describe("R6.08 Prometheus 0.0.4 exposition",()=>{
  it("emits exactly one valid HELP/TYPE per family and escaped labeled samples",()=>{
    const metrics=new McpMetrics();
    const unsafeTool='quoted"\\slash\nnewline';
    metrics.recordSessionCreated("session-one","fixture");
    metrics.recordToolCall(unsafeTool,12,true,"session-one");
    metrics.recordToolCall("read_file",5,false,"session-one");
    const output=metrics.getPrometheusMetrics();
    const helpers=new Map<string,number>();
    const types=new Map<string,string>();
    const samples=new Set<string>();
    for(const line of output.trimEnd().split("\n")){
      if(line.startsWith("# HELP ")){
        const match=line.match(/^# HELP ([a-zA-Z_:][a-zA-Z0-9_:]*) \S.+$/);
        expect(match,line).not.toBeNull();
        const name=match![1]!;
        helpers.set(name,(helpers.get(name)??0)+1);
        continue;
      }
      if(line.startsWith("# TYPE ")){
        const match=line.match(/^# TYPE ([a-zA-Z_:][a-zA-Z0-9_:]*) (counter|gauge)$/);
        expect(match,line).not.toBeNull();
        const name=match![1]!;
        expect(types.has(name),name).toBe(false);
        types.set(name,match![2]!);
        continue;
      }
      const match=line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{tool="(?:[^"\\]|\\.)*"\})? (-?\d+(?:\.\d+)?)$/);
      expect(match,line).not.toBeNull();
      const name=match![1]!;
      expect(helpers.has(name),name).toBe(true);
      expect(types.has(name),name).toBe(true);
      expect(Number.isFinite(Number(match![2]))).toBe(true);
      expect(samples.has(line),line).toBe(false);
      samples.add(line);
    }
    expect([...helpers.values()].every(count=>count===1)).toBe(true);
    expect([...helpers.keys()].sort()).toEqual([...types.keys()].sort());
    expect(types.get("mcp_sessions_total")).toBe("counter");
    expect(types.get("mcp_sessions_active")).toBe("gauge");
    expect(types.get("mcp_tool_calls_by_tool_total")).toBe("counter");
    expect(types.get("mcp_tool_errors_by_tool_total")).toBe("counter");
    expect(types.get("mcp_tool_duration_ms_by_tool")).toBe("gauge");
    const escaped=unsafeTool.replace(/\\/g,"\\\\").replace(/\n/g,"\\n").replace(/"/g,'\\"');
    expect(output).toContain('tool="'+escaped+'"');
    expect(output).not.toContain("# TYPE mcp_tool_calls{");
    expect(output).not.toContain("# HELP mcp_tool_calls{");
  });

  it("exports lifetime counters after rolling-window truncation and bounds tool-label cardinality",()=>{
    const metrics=new McpMetrics();
    for(let i=0;i<400;i++)metrics.recordToolCall("read_file",i%17,true,"fixture");
    for(let i=0;i<180;i++)metrics.recordToolCall("dynamic_tool_"+i,i%5,false,"fixture");
    const lines=metrics.getPrometheusMetrics().trimEnd().split("\n");
    expect(lines).toContain("mcp_tool_calls_total 580");
    expect(lines).toContain("mcp_tool_calls_successful_total 400");
    expect(lines).toContain("mcp_tool_calls_failed_total 180");
    expect(metrics.getSnapshot().toolCalls.total).toBeLessThan(580);
    const breakdown=lines.filter(line=>line.startsWith('mcp_tool_calls_by_tool_total{'));
    expect(breakdown.length).toBeLessThanOrEqual(128);
    expect(breakdown.some(line=>line.startsWith('mcp_tool_calls_by_tool_total{tool="__other__"}'))).toBe(true);
  });

  it("accepts the generated exposition with promtool when installed",()=>{
    const metrics=new McpMetrics();
    metrics.recordToolCall("read_file",10,true,"fixture");
    const check=spawnSync("promtool",["check","metrics"],{
      input:metrics.getPrometheusMetrics(),encoding:"utf8",timeout:6000,windowsHide:true
    });
    if((check.error as NodeJS.ErrnoException|undefined)?.code==="ENOENT")return;
    expect(check.status,(check.stdout||"")+(check.stderr||"")+
      String(check.error?.message??"")).toBe(0);
  });
});
