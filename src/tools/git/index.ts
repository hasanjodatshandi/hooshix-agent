import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { gitBranch, gitCheckout, gitClone, gitCommit, gitDiff, gitStatus } from "../../services/git/git-service.js";
import { auditToolCall } from "../../core/memory/tool-audit.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";

const context = { correlationId: z.string().min(1).optional(), taskId: z.string().optional() };
const cwd = z.string().default(".");

function result(value: unknown, correlationId: string) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], _meta: { correlationId } };
}

export function registerGitTools(server: McpServer) {
  server.registerTool("git_status", { title: "Git Status", description: "Show repository status", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }, inputSchema: z.object({ cwd, ...context }) }, async ({ cwd, correlationId, taskId }) => {
    const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("git_status", traceId, taskId, async () => result(await gitStatus(cwd, traceId), traceId));
  });
  server.registerTool("git_diff", { title: "Git Diff", description: "Show working tree or staged changes", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }, inputSchema: z.object({ cwd, staged: z.boolean().default(false), ...context }) }, async ({ cwd, staged, correlationId, taskId }) => {
    const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("git_diff", traceId, taskId, async () => result(await gitDiff(cwd, staged, traceId), traceId));
  });
  server.registerTool("git_clone", { title: "Git Clone", description: "Clone a credential-free HTTPS repository inside the workspace", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }, inputSchema: z.object({ url: z.url(), path: z.string(), ...context }) }, async ({ url, path, correlationId, taskId }) => {
    const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("git_clone", traceId, taskId, async () => result(await gitClone(url, path, traceId), traceId));
  });
  server.registerTool("git_commit", { title: "Git Commit", description: "Commit already staged changes", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }, inputSchema: z.object({ cwd, message: z.string().min(1).max(500), ...context }) }, async ({ cwd, message, correlationId, taskId }) => {
    const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("git_commit", traceId, taskId, async () => result(await gitCommit(cwd, message, traceId), traceId));
  });
  server.registerTool("git_branch", { title: "Git Branch", description: "Create a branch", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }, inputSchema: z.object({ cwd, name: z.string(), ...context }) }, async ({ cwd, name, correlationId, taskId }) => {
    const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("git_branch", traceId, taskId, async () => result(await gitBranch(cwd, name, traceId), traceId));
  });
  server.registerTool("git_checkout", { title: "Git Checkout", description: "Switch to an existing branch or create one", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false }, inputSchema: z.object({ cwd, name: z.string(), create: z.boolean().default(false), ...context }) }, async ({ cwd, name, create, correlationId, taskId }) => {
    const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("git_checkout", traceId, taskId, async () => result(await gitCheckout(cwd, name, create, traceId), traceId));
  });
}
