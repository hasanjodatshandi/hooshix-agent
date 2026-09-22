/** R3.10: optional audit/metric sinks cannot rewrite an external effect outcome.
 * A counter and fixed, non-sensitive diagnostic reveal degraded observability;
 * this wrapper is deliberately not used around authoritative Task/receipt writes.
 */
let failures=0;
function reportDegradedTelemetry():void{
  failures++;
  // A broken diagnostic stream must never rewrite the business outcome.
  try{console.error("hooshix_telemetry_degraded");}
  catch{/* best-effort diagnostic */}
}
export function bestEffortTelemetry(operation:()=>void):void{
  try{operation();}
  catch{reportDegradedTelemetry();}
}
/** Same invariant for asynchronous telemetry persistence, including legacy file audit. */
export async function bestEffortAsyncTelemetry(operation:()=>Promise<unknown>):Promise<void>{
  try{await operation();}
  catch{reportDegradedTelemetry();}
}
export function telemetryDegradationCount():number{return failures;}
