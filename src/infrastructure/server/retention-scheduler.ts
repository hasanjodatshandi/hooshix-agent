import {createRetentionPolicy,runRetention,type RetentionPolicy,type RetentionReport}
  from "../../core/memory/database/cleanup.js";

export interface PeriodicRetentionOptions {
  readonly policy?:RetentionPolicy;
  readonly intervalMs?:number;
  readonly now?:()=>number;
  readonly dryRun?:boolean;
  readonly onReport?:(report:RetentionReport)=>void;
  readonly onError?:(error:unknown)=>void;
  /** Injected only by fixture tests; production always uses the SQLite adapter. */
  readonly run?:()=>RetentionReport;
}

/** Startup + periodic retention. The unref'd timer never keeps an MCP stdio
 * process alive, concurrent ticks cannot overlap, and telemetry failures do
 * not interrupt the server's main business operation. */
export function startPeriodicRetention(options:PeriodicRetentionOptions={}):()=>void{
  const intervalMs=options.intervalMs??6*60*60_000;
  if(!Number.isSafeInteger(intervalMs)||intervalMs<1_000||intervalMs>30*86_400_000)
    throw new Error("Invalid retention interval");
  const policy=options.policy??createRetentionPolicy();
  let stopped=false;
  let running=false;
  const tick=()=>{
    if(stopped||running)return;
    running=true;
    try{
      const report=options.run?options.run():
        runRetention({policy,nowMs:options.now?.()??Date.now(),dryRun:options.dryRun});
      try{options.onReport?.(report);}catch(error){
        try{(options.onError??console.error)(error);}catch{/* telemetry must not stop cleanup */}
      }
    }catch(error){
      try{(options.onError??console.error)(error);}catch{/* telemetry must not stop agent */}
    }finally{running=false;}
  };
  tick();
  const timer=setInterval(tick,intervalMs);
  timer.unref?.();
  return ()=>{stopped=true;clearInterval(timer);};
}
