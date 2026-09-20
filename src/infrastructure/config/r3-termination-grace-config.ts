/** R3.03 bounded cancellation acknowledgement grace configuration. */
export function terminationGraceMs(env:Readonly<Record<string,string|undefined>>=process.env):number {
  const raw=env.HOOSHIX_TERMINATION_GRACE_MS;
  if(raw===undefined)return 5000;
  const value=Number(raw);
  if(!Number.isSafeInteger(value)||value<10||value>30000)
    throw new Error("HOOSHIX_TERMINATION_GRACE_MS must be an integer from 10 through 30000");
  return value;
}
