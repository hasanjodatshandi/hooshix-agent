/** Restricted environment for the separately enrolled WSL owner-session worker.
 * Never forward MCP server credentials or unrelated host environment variables.
 * Environment reads are centralized in infrastructure/config.
 */
export function permittedWSLOwnerChildEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const allowed = ["PATH", "PATHEXT", "SystemRoot", "SystemDrive", "WINDIR",
    "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "ProgramData"];
  const child: NodeJS.ProcessEnv = {};
  for (const name of allowed) if (env[name]) child[name] = env[name];
  return child;
}
