import {performance} from "node:perf_hooks";

/** Process-wide safe defaults. These are not MCP tool arguments and cannot
 * be relaxed by an untrusted search request. */
export const SEARCH_LIMITS=Object.freeze({
  maxScannedFiles:10_000,
  maxScannedBytes:16*1024*1024,
  maxResults:1_000,
  maxElapsedMs:10_000,
  maxConcurrent:4
});
export type SearchBudgetLimits=Readonly<Pick<typeof SEARCH_LIMITS,
  "maxScannedFiles"|"maxScannedBytes"|"maxResults"|"maxElapsedMs">>;

/** Monotonic, aggregate budget shared by every directory and file in one search.
 * Count BEFORE reading each file to avoid returning partial over-budget results.
 * Test fixtures can inject a smaller immutable policy and fake monotonic clock. */
export class SearchBudgetMeter{
  private files=0;
  private bytes=0;
  private results=0;
  private readonly startedAt:number;
  constructor(private readonly limits:SearchBudgetLimits=SEARCH_LIMITS,
    private readonly now:()=>number=()=>performance.now()){
    for(const [name,value] of Object.entries(limits)){
      if(!Number.isSafeInteger(value)||value<1)
        throw new Error("Invalid search budget "+name);
    }
    this.startedAt=now();
    if(!Number.isFinite(this.startedAt))throw new Error("Invalid search clock");
  }
  assertWithinTime():void{
    const elapsed=this.now()-this.startedAt;
    if(!Number.isFinite(elapsed)||elapsed<0||elapsed>this.limits.maxElapsedMs)
      throw new Error("Search exceeds "+this.limits.maxElapsedMs+" ms time budget");
  }
  recordFile():void{
    this.assertWithinTime();
    if(this.files>=this.limits.maxScannedFiles)
      throw new Error("Search exceeds "+this.limits.maxScannedFiles+" file limit");
    this.files++;
  }
  reserveBytes(size:number):void{
    this.assertWithinTime();
    if(!Number.isSafeInteger(size)||size<0)throw new Error("Invalid search file size");
    if(this.bytes+size>this.limits.maxScannedBytes)
      throw new Error("Search exceeds "+this.limits.maxScannedBytes+" aggregate byte budget");
    this.bytes+=size;
  }
  reconcileRead(reserved:number,actual:number):void{
    if(!Number.isSafeInteger(actual)||actual<0)throw new Error("Invalid search read size");
    if(actual>reserved)this.reserveBytes(actual-reserved);
    this.assertWithinTime();
  }
  recordResult():boolean{
    this.assertWithinTime();
    if(this.results>=this.limits.maxResults)
      throw new Error("Search exceeds "+this.limits.maxResults+" result limit");
    this.results++;
    return this.results>=this.limits.maxResults;
  }
  get counts():Readonly<{files:number;bytes:number;results:number}>{
    return {files:this.files,bytes:this.bytes,results:this.results};
  }
}

/** Reject concurrent over-capacity calls; do not queue unbounded searches.
 * A failed/cancelled operation releases its slot in finally. */
export class SearchConcurrencyLimiter{
  private active=0;
  constructor(private readonly limit:number=SEARCH_LIMITS.maxConcurrent){
    if(!Number.isSafeInteger(limit)||limit<1)throw new Error("Invalid search concurrency limit");
  }
  get activeCount():number{return this.active;}
  async run<T>(operation:()=>Promise<T>):Promise<T>{
    if(this.active>=this.limit)
      throw new Error("Search concurrency limit reached ("+this.limit+")");
    this.active++;
    try{return await operation();}
    finally{this.active--;}
  }
}
export const workspaceSearchLimiter=new SearchConcurrencyLimiter();
