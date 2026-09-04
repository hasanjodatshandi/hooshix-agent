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
  server.registerTool("git_status", { title: "Git Status", description: "Show repository status (staged, unstaged, untracked files).\n\nExample: { \"tool\": \"git_status\", \"arguments\": { \"cwd\": \".\" } }", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }, inputSchema: z.object({ cwd, ...context }) }, async ({ cwd, correlationId, taskId }) => {
    const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("git_status", traceId, taskId, async () => result(await gitStatus(cwd, traceId), traceId));
  });
  server.registerTool("git_diff", { title: "Git Diff", description: "Show working tree or staged changes.\n\nExamples:\n  { \"tool\": \"git_diff\", \"arguments\": { \"cwd\": \".\" } }                          — unstaged changes\n  { \"tool\": \"git_diff\", \"arguments\": { \"cwd\": \".\", \"staged\": true } }           — staged changes\n\nUse staged=true to see what will be committed.", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }, inputSchema: z.object({ cwd, staged: z.boolean().default(false), ...context }) }, async ({ cwd, staged, correlationId, taskId }) => {
    const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("git_diff", traceId, taskId, async () => result(await gitDiff(cwd, staged, traceId), traceId));
  });
  server.registerTool("git_clone", { title: "Git Clone", description: "Clone a credential-free HTTPS repository inside the workspace.\n\nExample: { \"tool\": \"git_clone\", \"arguments\": { \"url\": \"https://github.com/user/repo\", \"path\": \"my-project\" } }\n\nThe path is where the repo will be cloned to inside the workspace. Only HTTPS URLs without credentials are allowed.", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }, inputSchema: z.object({ url: z.url(), path: z.string(), ...context }) }, async ({ url, path, correlationId, taskId }) => {
    const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("git_clone", traceId, taskId, async () => result(await gitClone(url, path, traceId), traceId));
  });
  server.registerTool("git_commit", { title: "Git Commit", description: "Commit already staged changes. Run git_diff(staged=true) first to verify what will be committed.\n\nExample: { \"tool\": \"git_commit\", \"arguments\": { \"message\": \"feat: add login page\", \"cwd\": \".\" } }\n\nMessage is required, max 500 chars. Use conventional commit format (feat:, fix:, etc.).", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }, inputSchema: z.object({ cwd, message: z.string().min(1).max(500), ...context }) }, async ({ cwd, message, correlationId, taskId }) => {
    const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("git_commit", traceId, taskId, async () => result(await gitCommit(cwd, message, traceId), traceId));
  });
  server.registerTool("git_branch", { title: "Git Branch", description: "Create a new branch. Does NOT switch to it — use git_checkout afterwards.\n\nExample: { \"tool\": \"git_branch\", \"arguments\": { \"name\": \"feature/login\" } }", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }, inputSchema: z.object({ cwd, name: z.string(), ...context }) }, async ({ cwd, name, correlationId, taskId }) => {
    const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("git_branch", traceId, taskId, async () => result(await gitBranch(cwd, name, traceId), traceId));
  });
  server.registerTool("git_checkout", { title: "Git Checkout", description: "Switch to an existing branch or create a new one.\n\nExamples:\n  { \"tool\": \"git_checkout\", \"arguments\": { \"name\": \"main\" } }                      — switch to existing branch\n  { \"tool\": \"git_checkout\", \"arguments\": { \"name\": \"feature/x\", \"create\": true } }  — create and switch\n\nUse create=true to create a new branch. Without it, the branch must already exist.", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false }, inputSchema: z.object({ cwd, name: z.string(), create: z.boolean().default(false), ...context }) }, async ({ cwd, name, create, correlationId, taskId }) => {
    const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("git_checkout", traceId, taskId, async () => result(await gitCheckout(cwd, name, create, traceId), traceId));
  });
}
