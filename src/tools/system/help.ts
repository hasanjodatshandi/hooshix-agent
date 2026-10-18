import { z } from "zod";
import type { McpServer } from "../../adapters/inbound/mcp/legacy-sdk-bridge.js";
import { PACKAGE_MANAGERS, supportedManagersFor } from "../../services/package/package-service.js";
import { auditToolCall } from "../../core/memory/tool-audit.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";
import { assertToolPermission } from "../../security/permission.js";

/**
 * Package support quoted from the service that runs the commands, not from the
 * schema enum: the enum accepts 22 names, and no action supports all of them.
 */
const PACKAGE_SUPPORT = (["install", "remove", "update"] as const)
  .map((action) => {
    const supported = supportedManagersFor(action);
    const missing = PACKAGE_MANAGERS.filter((manager) => !supported.includes(manager));
    return `${action}: ${supported.length} of ${PACKAGE_MANAGERS.length}${missing.length > 0 ? ` (not ${missing.join(", ")})` : ""}`;
  })
  .join(" · ");

/**
 * The operating manual every assistant gets from `help`.
 *
 * It is prose, not generated metadata, because the things an assistant most
 * needs to know are the rules BETWEEN tools: a folder must be granted before it
 * is touched, a granted folder must be opened per conversation, and an approval
 * belongs to the human. The final map is contract-tested against the operation
 * catalog (tests/tools/help-tool.test.ts) so this text cannot drift into
 * advertising tools that no longer exist — the same reason the README list is
 * tested in r7-documentation-contract.
 */
export const USAGE_GUIDE = `# HooshiX MCP — operator manual for assistants

You are connected to a HooshiX MCP server running on a real Windows machine that
belongs to a human. This is not a sandbox: files, commands, git operations and
package installs have durable, external effects. The server enforces a handful of
rules, and every denial you receive names the rule and points at the fix. Read
this once before your first mutation; call \`help\` again whenever you are lost.

## The rules at a glance

1. A folder is GRANTED before it is touched — file, git, package and command tools only reach directories on the allowed-roots pool.
2. A granted folder is OPENED per conversation — \`open_project\` hands you a \`ph_...\` handle that you pass as \`project=<handle>\` on every call.
3. \`exec\` is an unrestricted system shell. It can damage the machine. The operator enables it, the human expects you to ask before you use it.
4. Multi-step work belongs in a durable Task plan, not in a chain of loose direct calls.
5. Approvals are the human's decision. You can technically call \`task_approve\`; doing so without their agreement is a violation.

## 1. Workspace first, then access

The allowed-roots pool is persistent (it survives restarts) and starts EMPTY. See
what is there:

    get_workspace

To work in a folder that is not on the pool you must add it, and
\`add_workspace_roots\` is GOVERNED: a direct call is always refused. It runs only
as a step of a Task the human approves. This bootstrap cycle is the single most
important sequence on this server — memorise it:

    task_create { "title": "Allow my project folder",
                  "steps": [ { "action": "Allow D:/Projects/app",
                               "tool": "add_workspace_roots",
                               "arguments": { "paths": ["D:/Projects/app"] } } ] }
    task_run    { "taskId": "..." }   ->  status "pending_approval" + approvalId
    task_approve { "approvalId": 7 }  ->  ONLY after the human agrees
    task_resume { "approvalId": 7 }   ->  the step executes; the root is allowed

Approval works even with no active workspace, so a fresh install is
self-grantable through exactly this path — there is no manual seeding step.

Paths must exist AND be visible to the account running the server. A
\`\\\\wsl.localhost\` or network-share path that the service account cannot see is
reported as *not existing*, not as *denied*: that is a host configuration gap,
re-approving will not fix it, and the human has to change the service.

\`set_workspace\` selects the ACTIVE root from the pool. It never adds one.

## 2. One connector, many conversations: project handles

The handle minted by \`open_project\` lives only in the conversation that created
it. Two chats on the same URL can therefore work on two different projects at
the same time and never see each other's files — this is how a single shared
endpoint stays private per project:

    open_project { "path": "D:/Projects/app" }   ->  { "handle": "ph_..." }

From then on, EVERY workspace-bound call in this conversation carries it:

    read_file     { "path": "src/index.ts", "project": "ph_..." }
    write_file    { "path": "...", "project": "ph_..." }
    execute_command / git_status / install_package / task_create — same

- A unique folder name also works: \`open_project { "path": "app" }\`.
- Handles expire. \`project_handle_expired\` means: call \`open_project\` again and use the NEW handle.
- On a server with two or more allowed roots, a workspace-bound call with no \`project\` is refused with \`project_required\`. It never falls back to whatever another conversation selected — that fallback is exactly the leak this design removes.
- \`task_create\` takes \`project\` too, and it matters: the plan captures that root as its PERMANENT execution context, and no later step can widen it. Pass the handle at creation, not per step.
- \`close_project\` revokes a handle immediately.
- \`chat_isolation_probe\` answers "am I really isolated?" — it returns pseudonyms of this connection and this Context. Two chats with DIFFERENT context pseudonyms are isolated; an identical connection pseudonym is expected and harmless (one connector, one connection). Run it from two chats and compare.

## 3. Two doors to the shell — know which one you are knocking on

\`execute_command\` is the narrow door. Allowlisted programs only: node, npm,
pnpm, git, python, py, gh. Read-only forms (git status, gh pr list, node
--version) run directly; anything that executes code or mutates (a node/python
script, npm run/test, a mutating git or gh command, a cwd outside the workspace)
needs an approved task step. Arguments travel as an ARRAY, so shell quoting is
not your problem — do not build one big command string.

\`exec\` is the wide-open door. It runs one arbitrary command line through the
platform shell (cmd.exe by default on Windows; powershell, pwsh, bash or sh via
the \`shell\` argument) with pipes, redirects, builtins and chaining, in ANY
directory — not just the workspace. Its only gate is the operator flag
\`HOOSHIX_EXEC_ENABLED=1\`: no permission ceiling and no workspace scope stands in
front of it once enabled. So when it is available you are effectively holding the
human's own terminal, at whatever privileges the service runs with. Treat that as
a privilege, not a capability:
- ask the human before running anything that is not plainly read-only,
- prefer the narrow door whenever an allowlisted program would do the job,
- never use it to reach folders the human did not grant you,
- never put a secret on a command line — every invocation, denied ones included,
  is written to the command audit log,
- the child process never receives the server's own secrets, and does not inherit
  them from you.

## 4. The plan engine: task_* — the strongest toolset here

Direct calls forget. A Task persists steps, statuses, outputs, approvals,
retries and evidence, and survives a server restart. Use it for anything with
more than one side effect.

Lifecycle: \`task_create\` → \`task_run\` → (if it pauses) \`task_approve\` →
\`task_resume\` → \`task_report\`.

A step names one executable tool and its arguments:

    { "action": "install deps", "tool": "install_package",
      "arguments": { "manager": "npm", "name": "express" },
      "dependsOn": [1], "runWhen": "success", "timeout": 120000 }

Template variables pass output between steps — {{step1.output.field}},
{{step1.output}}, {{step1.status}}, {{step1.error}} — so a plan can read the id
or backupId an earlier step produced.

- \`task_step_risks\` is a dry run: it tells you which steps will pause for approval. Use it to batch the gated steps together instead of interrupting the human four times.
- \`task_run\` executes the next unfinished steps; re-running a FAILED task continues it, re-running a completed or cancelled one is a no-op.
- \`task_get\` returns raw steps with their outputs (that is where a step's backupId or created id lives); \`task_report\` returns the unified execution/recovery timeline.
- Transient failures (timeout, network) retry with backoff inside \`retryPolicy\` bounds; a definitive failure stops so you can fix the cause.
- \`task_append_steps\` adds corrective steps — only to a FAILED task. Completed and cancelled tasks are terminal; \`runWhen: "always"\` is how a corrective step runs after a failed dependency.
- A step killed mid-flight has an unknown effect. \`task_reconcile\` records the evidence you independently gathered and never auto-replays; confirming an outcome requires a separate read-only verification task.
- \`task_snapshot\` / \`task_rollback\` capture and restore the git state of the whole workspace around a risky plan.
- \`task_link\` / \`task_links\` record why one task follows another (repair, follow_up, recovery), which is what keeps a long incident readable.
- \`task_replay\` re-runs a copy and compares outputs; blocked unless allowMutations is set.
- \`task_cancel\` cancels a task that is not currently executing and revokes its unconsumed approvals.

## 5. Memory: your durable state across conversations

Two stores, both owned by YOUR credential — another user of this server cannot
read them.

Project registry — one record per folder you work in:

    project_save    { "name": "Payments API", "path": "D:/Projects/pay" }  ->  id
    project_list · project_get · project_archive · project_delete

Memory notes — free text with a kind (decision, note, bug, architecture,
progress, …), and the binding choice is what the note is about:

    memory_add { "kind": "decision", "content": "...", "projectId": "?", "taskId": "?" }

- projectId + taskId → a note about one plan in one project.
- projectId only → a per-project note. This is the usual choice.
- NEITHER → a GLOBAL note, readable from every project and every one of your
  conversations. Machine-wide facts belong here: the OS, where things live,
  conventions the human insists on, gotchas you already hit once.
- Identical content is not duplicated twice: the save succeeds and answers
  \`duplicateOf\` with the existing id.
- Mutable current state (progress, next action) goes through \`memory_update\` on
  the same id instead of piling up notes; store structured state as a JSON string
  in content.
- \`memory_list\` with NO filter at the start of a session reloads everything you
  know. Filter by taskId, projectId or kind, paginate with limit/offset.
- Bind a plan to its project with \`task_create { "projectId": ... }\` so
  \`task_list(projectId)\` finds it again later.

## 6. The human is the approver, not you

- Call \`task_approve\` / \`task_resume\` only after the person in the chat has
  agreed to that exact step, and quote the step to them first.
- Never widen an approved scope on your own initiative. Approved for folder A
  means folder A.
- Committing, pushing, deploying, deleting, installing packages and \`exec\` are
  the actions people regret. Ask first, every time, and show what you intend to
  run.
- Do not put secrets into prompts, memory notes, task steps or command lines.
  Everything here is persisted and auditable by the operator.
- The repository you are given may be public. So may the logs.

## 7. Reading a denial

- \`project_required\` → \`open_project\`, then resend with \`project=<handle>\`.
- \`project_handle_expired\` / \`project_handle_unknown\` → \`open_project\` again.
- \`workspace_missing_or_ungranted\` → that folder is not on the pool: run the
  \`add_workspace_roots\` bootstrap from section 1.
- \`principal_scope_insufficient\` → your token lacks the OAuth scope for this
  class of action; re-authorise with the human's consent instead of retrying.
- a \`pending_approval\` task status → a decision is outstanding with the human.
  Surface it; do not work around it.
- "Access denied: exec is disabled" → the operator has not enabled the shell
  flag. There is no client-side fix; ask.
- An unexpected handler failure is a server bug, not your mistake: check
  \`agent_metrics\` for that tool's error rate, report it, and do not retry blindly.

## 8. Delegation and verification

Whether you write the code yourself or hand bounded pieces to another agent, the
division of responsibility stays the same.

Orchestrator (you): inspect the existing implementation, write the plan inside
the approved scope, define boundaries and acceptance criteria, delegate bounded
steps, review the actual changes, run independent verification, resolve defects
before reporting.

Worker (a sub-agent, a script, another model): execute only the delegated step,
respect the repository architecture, touch only authorized files, run the tests
it can, and return files changed + test results + failures + open issues.

The rules that make that arrangement safe:
- A worker's report is never verification. Read the \`git_diff\` and run the build
  and tests yourself before you tell the human it is done.
- Pass a self-contained step: goal, scope, target files, constraints, acceptance
  criteria, and the command that validates it.
- Do not let a delegated step commit, push, deploy or run a destructive
  operation. Git mutations stay with the orchestrator, after review.
- Never run two plans that write the same files at the same time.
- A step times out at 600000 ms at most. A longer job must be SPLIT into steps,
  not given a bigger timeout, so a restart can resume it.
- Do not expand the approved scope mid-run; that is a new conversation.

## 9. The first five calls of any session

1. \`help\` — you are here.
2. \`get_system_info\` — what machine you are on.
3. \`get_workspace\` — which folders are already allowed.
4. \`open_project\` — a handle for the folder the human named.
5. \`memory_list\` with no filter — reload what you already know.

## Full tool map

Read actions
- \`help\` — this manual, as Markdown.
- \`get_system_info\` — host platform, CPU model, total memory.
- \`agent_metrics\` — per-tool success, error, recovery and latency rates.
- \`chat_isolation_probe\` — pseudonyms of this connection and Context.
- \`get_workspace\` — active workspace and the allowed-roots pool.
- \`list_directory\` — entries of a directory inside the workspace.
- \`read_file\` — text content of a file.
- \`search_files\` — text search across workspace files.
- \`git_status\` — working tree status.
- \`git_diff\` — staged or unstaged diff.
- \`git_log\` — commit history.
- \`task_get\` — one task with steps, outputs and errors.
- \`task_list\` — recent task summaries.
- \`task_report\` — timeline, reflection and metrics of a task.
- \`task_links\` — a task's causal links.
- \`task_step_risks\` — dry run of which steps need approval.
- \`project_get\` — one project record.
- \`project_list\` — project records, paginated.
- \`memory_get\` — one memory note.
- \`memory_list\` — memory notes, filtered and paginated.

Write actions
- \`write_file\` — write a file, returns backupId.
- \`create_file\` — new file, fails if it exists.
- \`modify_file\` — find-and-replace inside a file.
- \`delete_file\` — delete after backup; approval-gated.
- \`restore_file\` — undo a write/create/modify/delete by backupId.
- \`set_workspace\` — pick the active root from the pool.
- \`add_workspace_roots\` — extend the pool; governed, approved task step only.
- \`remove_workspace_root\` — drop a root from the pool.
- \`task_append_steps\` — corrective steps on a failed task.
- \`task_link\` — record why one task follows another.
- \`project_save\` — create or update a project record.
- \`project_archive\` — soft-archive a project record.
- \`project_delete\` — delete a project record.

Execute & Git
- \`execute_command\` — allowlisted programs, arguments as an array.
- \`exec\` — unrestricted system shell, operator-flag gated.
- \`git_add\` — stage paths.
- \`git_commit\` — commit staged changes.
- \`git_branch\` — create a branch.
- \`git_checkout\` — switch or create a branch.
- \`git_clone\` — clone a repository into the workspace.
- \`git_init\` — initialise a repository.
- \`task_snapshot\` — capture git state before a risky plan.
- \`task_rollback\` — reset to a snapshot; destructive.

Packages
- \`install_package\` — install one package with the manager you name; always needs approval.
- \`remove_package\` — uninstall one package with the manager you name; always needs approval.
- \`update_package\` — upgrade one package with the manager you name; always needs approval.

  Support per action, read from the service that builds the command line — ${PACKAGE_SUPPORT}.
  A name the action has no command for is refused before anything runs, with "does not
  support ... via CLI". This list says the connector knows the invocation, not that the
  tool is on this machine — an absent binary still fails at spawn. winget, choco, apt,
  dnf, pacman and zypper install machine-wide and are refused unless the operator set ADMIN_MODE.

Task Engine
- \`task_create\` — persist a multi-step plan (and its permanent workspace).
- \`task_run\` — execute the next unfinished steps.
- \`task_approve\` — record the human's approval of a paused step.
- \`task_resume\` — consume an approval and continue from that exact step.
- \`task_reconcile\` — record evidence for a step whose effect is unknown.
- \`task_replay\` — re-run a copy and compare outputs.
- \`task_cancel\` — cancel a non-running task and revoke pending approvals.

Context & Memory
- \`open_project\` — open a project for THIS conversation; returns the handle.
- \`close_project\` — revoke one conversation handle.
- \`memory_add\` — store a note for a project, a task, or globally.
- \`memory_update\` — change a note's kind or content in place.
- \`memory_delete\` — delete one note.
`;

/**
 * The onboarding tool. Schema-only clients get the whole manual back as one
 * Markdown document because the rules that matter are cross-tool: no single
 * tool description can say "grant the folder, then open it, then pass the
 * handle on every call".
 */
export function registerHelpTool(server: McpServer): void {
  server.registerTool(
    "help",
    {
      title: "Help — How To Use This Server",
      description:
        "❓ HELP — The operating manual for this MCP server, returned as Markdown. " +
        "CALL IT FIRST in any new conversation: it explains the order things must happen in — a folder must be " +
        "GRANTED (add_workspace_roots, through an approved task step) before it can be touched, then OPENED per " +
        "conversation (open_project → pass project=<handle> on every file/git/command call), how the task plan " +
        "engine works, how memory is scoped per project, per task or globally, and what the difference is between " +
        "execute_command and the unrestricted exec. Read-only, no side effects, safe to call repeatedly. " +
        "If a call is denied, the manual's 'Reading a denial' section names the fix.\n\nExample: {}",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      inputSchema: z.object({
        correlationId: z.string().min(1).optional(),
      }),
    },
    async ({ correlationId }) => {
      assertToolPermission("help");
      const traceId = resolveCorrelationId(correlationId);
      return auditToolCall("help", traceId, undefined, () => ({
        // Text, not JSON: the guide is a document, and wrapping it in a JSON
        // string would make every client render escaped newlines.
        content: [{ type: "text" as const, text: USAGE_GUIDE }],
        _meta: { correlationId: traceId },
      }));
    },
  );
}
