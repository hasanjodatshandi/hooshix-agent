/** R3.10: optional audit/metric sinks cannot rewrite an external effect outcome.
 * A counter and fixed, non-sensitive diagnostic reveal degraded observability;
 * this wrapper is deliberately not used around authoritative Task/receipt writes.
 */
let failures=0;
export function bestEffortTelemetry(operation:()=>void):void {
  try{operation();}
  catch{
    failures++;
    console.error("hooshix_telemetry_degraded");
  }
}
export function telemetryDegradationCount():number{return failures;}
