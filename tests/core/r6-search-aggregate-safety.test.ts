import fs from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {describe,expect,it} from "vitest";
import {SearchBudgetMeter,SearchConcurrencyLimiter,SEARCH_LIMITS}
  from "../../src/services/filesystem/search-budget.js";
import {searchWorkspaceFiles}
  from "../../src/services/filesystem/filesystem-service.js";

describe("R6.05 bounded filesystem search contracts",()=>{
  const limits={maxScannedFiles:2,maxScannedBytes:8,maxResults:2,maxElapsedMs:10};
  it("enforces aggregate file, byte, result and monotonic time caps",()=>{
    let now=100;
    const meter=new SearchBudgetMeter(limits,()=>now);
    meter.recordFile();meter.reserveBytes(5);meter.reconcileRead(5,7);
    expect(meter.counts).toEqual({files:1,bytes:7,results:0});
    expect(meter.recordResult()).toBe(false);
    expect(meter.recordResult()).toBe(true);
    expect(()=>meter.recordResult()).toThrow(/result limit/);
    meter.recordFile();
    expect(()=>meter.recordFile()).toThrow(/file limit/);
    expect(()=>meter.reserveBytes(2)).toThrow(/aggregate byte budget/);
    now+=11;
    expect(()=>meter.assertWithinTime()).toThrow(/time budget/);
    expect(()=>new SearchBudgetMeter({...limits,maxScannedFiles:0})).toThrow(/maxScannedFiles/);
    expect(SEARCH_LIMITS.maxConcurrent).toBeGreaterThan(0);
  });

  it("rejects concurrent calls above cap and releases capacity on success and failure",async()=>{
    const limiter=new SearchConcurrencyLimiter(1);
    let resolveFirst!:(value:string)=>void;
    const pending=new Promise<string>(resolve=>{resolveFirst=resolve;});
    const first=limiter.run(()=>pending);
    expect(limiter.activeCount).toBe(1);
    await expect(limiter.run(async()=> "denied")).rejects.toThrow(/concurrency limit/);
    resolveFirst("ok");
    await expect(first).resolves.toBe("ok");
    expect(limiter.activeCount).toBe(0);
    await expect(limiter.run(async()=>{throw new Error("fixture error");}))
      .rejects.toThrow(/fixture error/);
    expect(limiter.activeCount).toBe(0);
    await expect(limiter.run(async()=> "recovered")).resolves.toBe("recovered");
  });

  it("truncates actual workspace search at 1000 hits without exposing absolute paths",async()=>{
    const testsRoot=path.resolve("tests");
    const root=fs.mkdtempSync(path.join(testsRoot,".r6-search-"));
    const marker=path.join(root,".r6-search-marker");
    const owner=randomUUID();
    fs.writeFileSync(marker,owner,{flag:"wx"});
    try{
      fs.writeFileSync(path.join(root,"many.txt"),Array.from({length:1001},()=>"needle").join("\n"),{flag:"wx"});
      const result=await searchWorkspaceFiles(root,"needle");
      expect(result.matches).toHaveLength(1000);
      expect(result.totalMatches).toBe(1000);
      expect(result.truncated).toBe(true);
      expect(result.matches.every(hit=>hit.path==="many.txt")).toBe(true);
      expect(result.root).not.toContain(root);
    }finally{
      if(path.dirname(root)===testsRoot&&path.basename(root).startsWith(".r6-search-")&&
        !fs.lstatSync(root).isSymbolicLink()&&
        fs.readFileSync(marker,"utf8")===owner)
        fs.rmSync(root,{recursive:true,force:true});
    }
  });
});
