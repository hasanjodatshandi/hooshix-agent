import { z } from "zod";
import type { McpServer } from "../../adapters/inbound/mcp/legacy-sdk-bridge.js";

/** Schema-only MCP registrar. Process dispatch is available exclusively via R2 gateway. */
export function registerExecTool(server: McpServer) {
  server.registerTool("exec", {
    title: "Exec (Unrestricted Shell)",
    description: "⚡ EXEC (UNRESTRICTED) — Run an arbitrary shell command line with NO restrictions: no command allowlist, no pattern blocking, no workspace scope. Full shell semantics — pipes (|), redirects (> >>), builtins, chaining (&& ;), variables — anywhere on the filesystem, exactly like an interactive PowerShell/bash terminal.\n\nACCESS: requires ADMIN_MODE permission AND the operator flag HOOSHIX_EXEC_ENABLED=1 (off by default). When either is missing the call is denied and audited. Nothing else gates this tool — it is deliberately unrestricted, so use it as you would your own terminal.\n\nThe command string is run through the platform shell (cmd.exe on Windows, /bin/sh on Linux). Pass `shell` to pick an interpreter explicitly: powershell, pwsh, bash, sh, cmd.\n\ncwd defaults to the server process directory; any absolute path works. timeout: ms, 100-600000 (default 60000).\n\nEvery invocation is written to the command audit log (logs/command-actions.log), including denied ones. The child never receives the server's HOOSHIX_* secrets.\n\nExamples: { \"command\": \"Get-Process | Select-Object -First 3\", \"shell\": \"powershell\" } · { \"command\": \"dir | findstr README\" } · { \"command\": \"gradle build --no-daemon\", \"cwd\": \"D:/proj\", \"timeout\": 300000 }",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    inputSchema: z.object({
      command: z.string().min(1),
      cwd: z.string().optional(),
      timeout: z.number().int().min(100).max(600000).default(60000),
      shell: z.enum(["cmd", "powershell", "pwsh", "bash", "sh"]).optional(),
      correlationId: z.string().min(1).optional(),
      taskId: z.string().optional()
    })
  }, async () => { throw new Error("r2_legacy_direct_callback_retired"); });
}
