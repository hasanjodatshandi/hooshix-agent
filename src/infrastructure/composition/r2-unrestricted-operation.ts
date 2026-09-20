/** An unrestricted capability is always per-effect, never an HTTP session or process flag. */
export const UNRESTRICTED_FILE_OPERATIONS: ReadonlySet<string> = new Set([
  "read_file","list_directory","search_files",
  "write_file","create_file","modify_file","delete_file",
]);
export function requestsUnrestrictedEffect(toolId:string,args:unknown):boolean {
  return UNRESTRICTED_FILE_OPERATIONS.has(toolId) &&
    !!args && typeof args==="object" && !Array.isArray(args) &&
    (args as Record<string,unknown>).unrestricted===true;
}
export function hasInvalidUnrestrictedArgument(toolId:string,args:unknown):boolean {
  if(!args||typeof args!=="object"||Array.isArray(args))return false;
  const object=args as Record<string,unknown>;
  return Object.hasOwn(object,"unrestricted") &&
    (object.unrestricted!==true || !UNRESTRICTED_FILE_OPERATIONS.has(toolId));
}
