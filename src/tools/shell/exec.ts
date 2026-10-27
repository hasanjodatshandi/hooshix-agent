import { z } from "zod";
import type { McpServer } from "../../adapters/inbound/mcp/legacy-sdk-bridge.js";

/** Schema-only MCP registrar. Process dispatch is available exclusively via R2 gateway. */
export function registerExecTool(server: McpServer) {
  server.registerTool("exec", {
    title: "Exec (Unrestricted Shell)",
    description: "⚡ EXEC (UNRESTRICTED) — Run an arbitrary shell command line with NO restrictions: no command allowlist, no pattern blocking, no workspace scope. Full shell semantics — pipes (|), redirects (> >>), builtins, chaining (&& ;), variables — anywhere on the filesystem, exactly like an interactive PowerShell/bash terminal.\n\nACCESS: gated by the operator flag HOOSHIX_EXEC_ENABLED=1 alone (off by default); no permission level blocks this tool. Without the flag the call is denied and audited. Nothing else gates it — it is deliberately unrestricted, so use it as you would your own terminal.\n\nThis Windows-only tool runs through cmd.exe by default. The `shell` option accepts cmd, powershell or pwsh only; Linux, WSL and POSIX shells are not supported. When explicitly enabled, `exec` can use any working directory permitted to the configured Windows service account; it does not bypass operating-system permissions.\n\ncwd defaults to the server process directory; any absolute path works. timeout: ms, 100-600000 (default 600000).\n\nEvery invocation is written to the command audit log (logs/command-actions.log), including denied ones. The child never receives the server's HOOSHIX_* secrets.\n\nExamples: { \"command\": \"Get-Process | Select-Object -First 3\", \"shell\": \"powershell\" } · { \"command\": \"dir | findstr README\" } · { \"command\": \"gradle build --no-daemon\", \"cwd\": \"D:/proj\", \"timeout\": 300000 }",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    inputSchema: z.object({
      command: z.string().min(1),
      cwd: z.string().optional(),
      timeout: z.number().int().min(100).max(600000).default(600000),
      shell: z.enum(["cmd", "powershell", "pwsh"]).optional(),
      correlationId: z.string().min(1).optional(),
      taskId: z.string().optional()
    })
  }, async () => { throw new Error("r2_legacy_direct_callback_retired"); });
}
