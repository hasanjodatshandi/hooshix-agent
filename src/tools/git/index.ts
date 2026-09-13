import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { gitAdd, gitBranch, gitCheckout, gitClone, gitCommit, gitDiff, gitHasIdentity, gitInit, gitLog, gitStatus } from "../../services/git/git-service.js";
import { auditToolCall } from "../../core/memory/tool-audit.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";

const context = { correlationId: z.string().min(1).optional(), taskId: z.string().optional() };
const cwd = z.string().default(".");

function result(value: unknown, correlationId: string) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], _meta: { correlationId } };
}

export function registerGitTools(server: McpServer) {
  server.registerTool("git_status", { title: "Git Status", description: "🔀 GIT (read) — Working tree status: staged, unstaged, untracked + branch info.\n\nExample: { \"cwd\": \".\" }", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }, inputSchema: z.object({ cwd, ...context }) }, async ({ cwd, correlationId, taskId }) => {
    const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("git_status", traceId, taskId, async () => result(await gitStatus(cwd, traceId), traceId));
  });
  server.registerTool("git_diff", { title: "Git Diff", description: "🔀 GIT (read) — Show unstaged changes, or staged with staged=true (what a commit would include).\n\nExamples: { \"cwd\": \".\" } · { \"staged\": true }", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }, inputSchema: z.object({ cwd, staged: z.boolean().default(false), ...context }) }, async ({ cwd, staged, correlationId, taskId }) => {
    const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("git_diff", traceId, taskId, async () => result(await gitDiff(cwd, staged, traceId), traceId));
  });
  server.registerTool("git_clone", { title: "Git Clone", description: "🔀 GIT (mutation, needs approval) — Clone a public HTTPS repo (no embedded credentials) into the workspace.\n\nExample: { \"url\": \"https://github.com/user/repo\", \"path\": \"my-project\" }", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }, inputSchema: z.object({ url: z.url(), path: z.string(), ...context }) }, async ({ url, path, correlationId, taskId }) => {
    const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("git_clone", traceId, taskId, async () => result(await gitClone(url, path, traceId), traceId));
  });
  server.registerTool("git_commit", { title: "Git Commit", description: "🔀 GIT (mutation, needs approval) — Commit staged changes. Check with git_diff(staged=true) first. Message 1-500 chars; fails with git_identity_missing if user.name/email unset.\n\nExample: { \"message\": \"feat: add login page\", \"cwd\": \".\" }", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }, inputSchema: z.object({ cwd, message: z.string().min(1).max(500), ...context }) }, async ({ cwd, message, correlationId, taskId }) => {
    const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("git_commit", traceId, taskId, async () => {
      const hasIdentity = await gitHasIdentity(cwd);
      if (!hasIdentity) return result({ status: "blocked", reason: "git_identity_missing", message: "Configure git user.name and user.email before committing. Use execute_command to run: git config user.name 'Your Name' && git config user.email 'you@example.com'" }, traceId);
      return result(await gitCommit(cwd, message, traceId), traceId);
    });
  });
  server.registerTool("git_branch", { title: "Git Branch", description: "🔀 GIT (mutation, needs approval) — Create a branch without switching. Use git_checkout to switch.\n\nExample: { \"name\": \"feature/login\" }", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }, inputSchema: z.object({ cwd, name: z.string(), ...context }) }, async ({ cwd, name, correlationId, taskId }) => {
    const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("git_branch", traceId, taskId, async () => {
      const raw = await gitBranch(cwd, name, traceId);
      return result({ created: true, branch: name, checkedOut: false, ...raw }, traceId);
    });
  });
  server.registerTool("git_checkout", { title: "Git Checkout", description: "🔀 GIT (mutation, needs approval) — Switch branch; create=true to create-and-switch.\n\nExamples: { \"name\": \"main\" } · { \"name\": \"feature/x\", \"create\": true }", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false }, inputSchema: z.object({ cwd, name: z.string(), create: z.boolean().default(false), ...context }) }, async ({ cwd, name, create, correlationId, taskId }) => {
    const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("git_checkout", traceId, taskId, async () => {
      const raw = await gitCheckout(cwd, name, create, traceId);
      return result({ branch: name, created: create, switched: true, ...raw }, traceId);
    });
  });
  server.registerTool("git_add", { title: "Git Add", description: "🔀 GIT (mutation, needs approval) — Stage files for commit. paths=[\".\"] stages everything.\n\nExample: { \"paths\": [\"src/file.ts\"] }", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }, inputSchema: z.object({ cwd, paths: z.array(z.string()).min(1).max(100), ...context }) }, async ({ cwd, paths, correlationId, taskId }) => {
    const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("git_add", traceId, taskId, async () => result(await gitAdd(cwd, paths, traceId), traceId));
  });
  server.registerTool("git_init", { title: "Git Init", description: "🔀 GIT (mutation) — Initialize a new git repository. Default branch: main.\n\nExample: { \"path\": \"D:/Projects/my-new-project\" }", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }, inputSchema: z.object({ path: z.string(), initialBranch: z.string().default("main"), ...context }) }, async ({ path, initialBranch, correlationId, taskId }) => {
    const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("git_init", traceId, taskId, async () => result(await gitInit(path, initialBranch, traceId), traceId));
  });
  server.registerTool("git_log", { title: "Git Log", description: "🔀 GIT (read) — Recent commit history, one line per commit with refs. limit 1-100 (default 20).\n\nExample: { \"limit\": 10 }", annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }, inputSchema: z.object({ cwd, limit: z.number().int().min(1).max(100).default(20), ...context }) }, async ({ cwd, limit, correlationId, taskId }) => {
    const traceId = resolveCorrelationId(correlationId);
    return auditToolCall("git_log", traceId, taskId, async () => result(await gitLog(cwd, limit, traceId), traceId));
  });
}
