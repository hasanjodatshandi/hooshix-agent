# HooshiX Tool Reference

**Source of truth:** `src/application/services/operation-catalog.ts` — 53 registered tools, asserted by `tests/core/r2-operation-catalog.test.ts`. This document is a human-readable view of that catalog; if the two disagree, the catalog and the test are correct and this file must be regenerated.

Every tool is registered through the single R2 gateway in `src/mcp/registry.ts` (`registerTools()`), so no tool can bypass `ExecuteToolUseCase`.

## Risk classes and approval

| Mark | Meaning |
|---|---|
| *low* | Read-only, no approval |
| *medium* | Mutating, approval on risk (`approval:"on-risk"`) |
| *high* | Mutating, approval always (`approval:"always"`) |
| *critical* | Destructive or installs software, approval always |

**Approval tags** describe the catalog's own declaration. The runtime policy layer (`src/core/governance/policy-decision-point.ts`) additionally requires that 14 of these run **inside an approved task step** when called directly over MCP; the bypass is `HOOSHIX_DIRECT_AUTO_APPROVE=1`, except for `add_workspace_roots` and `remove_workspace_root`, which must *always* go through a governed task step.

## Read actions — 18 tools, all low risk, no approval

| Tool | Purpose |
|---|---|
| `get_system_info` | Local machine info: platform, CPU model, total memory |
| `agent_metrics` | Recovery, tool reliability, performance dashboard |
| `list_directory` | List files/dirs inside the active workspace |
| `read_file` | Read a file (relative or absolute path) |
| `search_files` | Search text inside workspace files |
| `git_status` | Show git working tree status |
| `git_diff` | Show git diff (staged or unstaged) |
| `git_log` | Show recent commit history |
| `get_workspace` | View active workspace + allowed roots pool |
| `task_get` | Full task object: state, steps, outputs, pending approval |
| `task_list` | Recent task summaries: ids, titles, statuses |
| `task_report` | Step statuses, execution/recovery timeline, metrics |
| `task_links` | A task's causal links: upstream and downstream |
| `task_step_risks` | Dry-run: which planned steps will require approval |
| `project_get` | Fetch one project record by id |
| `project_list` | List project records, paginated; filter by status |
| `memory_list` | List memory notes; filter by taskId/projectId/kind |
| `memory_get` | Fetch one memory record by id |

## Write actions — 16 tools

| Tool | Purpose | Risk | Approval |
|---|---|---|---|
| `write_file` | Write content to a file; overwrites; returns backupId | medium | on-risk |
| `create_file` | Create a new file; fails if exists; returns backupId | medium | on-risk |
| `modify_file` | Find-and-replace text in a file; returns backupId | medium | on-risk |
| `delete_file` | Delete a file after backup; returns backupId | high | always |
| `restore_file` | Restore a file from a backupId | medium | on-risk |
| `set_workspace` | Select active workspace from the allowed roots pool | medium | on-risk |
| `add_workspace_roots` | Add dirs to persistent allowed-roots pool, idempotent | high | always |
| `remove_workspace_root` | Remove a directory from the allowed roots pool | medium | on-risk |
| `task_cancel` | Cancel a non-running task; revoke unconsumed approvals | medium | on-risk |
| `task_append_steps` | Add corrective steps to a failed/cancelled task | high | — |
| `task_link` | Record a causal link between two tasks | medium | on-risk |
| `project_save` | Create or update a project record | medium | on-risk |
| `project_delete` | Permanently delete a project record by id | high | always |
| `project_archive` | Soft-archive a project (status → 'archived') | medium | on-risk |
| `memory_add` | Store a categorized note for a project or task | medium | on-risk |
| `memory_delete` | Permanently delete one memory record by id | high | always |

## Execute & Git — 9 tools

| Tool | Purpose | Risk | Approval |
|---|---|---|---|
| `execute_command` | Run a whitelisted command (node, npm, pnpm, git, python, gh) | high | on-risk |
| `git_clone` | Clone an HTTPS repo into the workspace | high | always |
| `git_commit` | Commit staged changes with a message | high | always |
| `git_branch` | Create a new git branch | high | always |
| `git_checkout` | Switch to a branch, or create-and-switch | high | always |
| `git_add` | Stage files for the next commit | high | always |
| `git_init` | Initialize a new git repository | medium | always |
| `task_snapshot` | Capture a git snapshot of a workspace pre-task | medium | on-risk |
| `task_rollback` | Reset a workspace to its pre-task snapshot, destructive | critical | always |

## Packages — 4 tools

| Tool | Purpose | Risk | Approval |
|---|---|---|---|
| `install_package` | Install via npm, pnpm, pip, winget, choco… | critical | always |
| `remove_package` | Remove a package | critical | always |
| `update_package` | Update a package | critical | always |
| `package_restore` | **DEPRECATED:** restore manifest files only from snapshotId | high | always |

## Task engine — 6 tools

| Tool | Purpose | Risk |
|---|---|---|
| `task_create` | Persist an explicit multi-step plan | medium |
| `task_run` | Execute a task's next unfinished steps sequentially | high |
| `task_approve` | Human approval for a paused high-risk step; single-use | high |
| `task_resume` | Consume an approval; continue paused task; exactly-once | high |
| `task_reconcile` | Reconcile unknown step outcomes after interruption | high |
| `task_replay` | Re-execute a copy of a task and compare outputs | high |

These six declare `approval:"never"` because approval is enforced **at the step level inside the task loop**, not on the tool itself.

## Step-executable vs control plane

- **30 `TOOL_NAMES`** — usable as a task-step operation *and* directly callable (dispatched via `executeAuthorizedDirectTool`).
- **23 `CONTROL_TOOL_NAMES`** — management-plane only: directly callable but **not step-executable**.
- **No tool is task-step-only.** Every tool reaches the filesystem through the same `ExecuteToolUseCase` gateway.
