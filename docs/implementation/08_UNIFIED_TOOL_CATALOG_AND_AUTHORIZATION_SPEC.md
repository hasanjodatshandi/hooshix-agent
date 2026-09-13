# Unified Tool Catalog & Authorization Specification

**Primary findings:** HIGH-01, HIGH-02, HIGH-03, MED-04, MED-06, MED-28; supports HIGH-04 and HTTP principal scopes.

The core security architecture change is to make authorization unavoidable and data-driven, without duplicating policy lists across MCP adapters, task handlers, permission maps and command policy.

---

## 1. One operation catalog

Define a pure application/domain `OperationDescriptor` for **every externally invokable MCP operation**, including control-plane/task/project/memory operations.

```ts
interface OperationDescriptor {
  id: OperationId;
  requiredPermission: PermissionLevel;
  risk: ToolRisk;
  approvalPolicy: ApprovalPolicy;
  effect: ToolEffect;
  workspaceBehavior: WorkspaceBehavior;
  securityClass:
    | "read"
    | "workspace_scope"
    | "file_mutation"
    | "process"
    | "git_mutation"
    | "package_mutation"
    | "task_control"
    | "authorization"
    | "monitoring";
  supportsIdempotency: boolean;
}
```

`ToolDescriptor` is a subtype/alias for operations that execute through `ExecuteToolUseCase`.

Task/project/memory control operations are authorized by the same `AuthorizationService` using their descriptors even if they have distinct application use cases.

No separate `requiredLevel`, `APPROVAL_TOOLS`, `TOOL_CAPABILITIES` and adapter-specific policy tables may independently define the same facts.

---

## 2. Canonical execution-tool catalog policy

Recommended target policy for current execution tools:

| Tool | Permission | Risk | Approval | Effect | Workspace behavior |
|---|---|---:|---|---|---|
| `get_system_info` | READ_ONLY | low | never | read_only | none |
| `agent_metrics` | READ_ONLY + monitoring scope on HTTP | low | never | read_only | none |
| `list_directory` | READ_ONLY | low | never | read_only | read |
| `read_file` | READ_ONLY | low | never | read_only | read |
| `search_files` | READ_ONLY | low | never | read_only | read |
| `write_file` | PROJECT_ACCESS | medium | conditional via revision/idempotency policy | idempotent_mutation where key/precondition supplied; otherwise mutation | write |
| `create_file` | PROJECT_ACCESS | medium | conditional | idempotent_mutation if exclusive-create semantics sufficient for request | write |
| `modify_file` | PROJECT_ACCESS | medium | conditional | mutation with revision precondition preferred | write |
| `delete_file` | PROJECT_ACCESS | high | always | non_idempotent_mutation unless durable idempotency receipt | write |
| `restore_file` | PROJECT_ACCESS | high | always for historical overwrite; conditional for exact immediate compensation | non_idempotent_mutation | write |
| `execute_command` | DEVELOPER_MODE | high | conditional/usually always; only exact safe probes auto-allow | non_idempotent_mutation by default | process |
| `git_status` | READ_ONLY | low | never | read_only | read |
| `git_diff` | READ_ONLY | low | never for dedicated repo diff only | read_only | read |
| `git_log` | READ_ONLY | low | never | read_only | read |
| `git_clone` | DEVELOPER_MODE | high | always | non_idempotent_mutation | write/process |
| `git_add` | DEVELOPER_MODE | high | always | non_idempotent_mutation | write |
| `git_commit` | DEVELOPER_MODE | high | always | non_idempotent_mutation | write |
| `git_branch` | DEVELOPER_MODE | high | always | non_idempotent_mutation | write |
| `git_checkout` | DEVELOPER_MODE | high | always | non_idempotent_mutation | write |
| `git_init` | DEVELOPER_MODE | medium/high | always on direct path | non_idempotent_mutation | write |
| `install_package` | DEVELOPER_MODE | critical | always | non_idempotent_mutation | process |
| `remove_package` | DEVELOPER_MODE | critical | always | non_idempotent_mutation | process |
| `update_package` | DEVELOPER_MODE | critical | always | non_idempotent_mutation | process |
| `package_restore` | DEVELOPER_MODE | high | always | manifest mutation only | write/process |
| `task_snapshot` | DEVELOPER_MODE | medium | conditional; requires clean repo | read/write metadata | read |
| `task_rollback` | DEVELOPER_MODE | critical | always | non_idempotent_mutation | write/process |
| `set_workspace` | DEVELOPER_MODE | high | **always for scope expansion; ADMIN+approval for unrestricted** | scope mutation | scope_mutation |
| `get_workspace` | READ_ONLY | low | never | read_only | none |
| `remove_workspace_root` | DEVELOPER_MODE | medium | authorized + audited | scope mutation | scope_mutation |
| `replace_workspace_roots` | DEVELOPER_MODE | high | approval if expands effective scope; ADMIN+approval if unrestricted | scope mutation | scope_mutation |

Exact risk/approval policies may be adjusted only through an ADR plus updated acceptance tests; they must not drift per adapter.

---

## 3. Control-plane operation catalog

At minimum include descriptors for:

- `task_create`, `task_get`, `task_list`, `task_run`, `task_resume`, `task_approve`, `task_cancel`, `task_append_steps`, `task_report`, `task_snapshot`, `task_rollback`, `task_replay`, `task_link`, `task_links`, `task_step_risks`;
- `project_save`, `project_get`, `project_list`, `project_archive`, `project_delete`;
- `memory_add`, `memory_get`, `memory_list`, `memory_delete`;
- workspace root management;
- monitoring operations.

Current permission levels can be preserved as the starting server ceiling, but all operation descriptors must be exhaustive and tested.

---

## 4. Principal and effective authority

### 4.1 Server ceiling

`HOOSHIX_PERMISSION_LEVEL` (or renamed canonical config field) defines the maximum server capability:

```text
READ_ONLY < PROJECT_ACCESS < DEVELOPER_MODE < ADMIN_MODE
```

### 4.2 HTTP principal scopes

Suggested OAuth scope mapping:

- `hooshix:read`
- `hooshix:project:write`
- `hooshix:execute`
- `hooshix:task:manage`
- `hooshix:workspace:manage`
- `hooshix:admin`
- `hooshix:monitoring:read`

Access token scope can only reduce authority below the server ceiling.

### 4.3 Local stdio principal

Local stdio creates a `local_stdio` Principal using the configured server permission ceiling. It does not use the HTTP OAuth flow.

### 4.4 Effective decision

The authorization service checks:

1. operation exists;
2. principal permission/scope satisfies operation requirement;
3. server permission ceiling permits it;
4. workspace/session/task scope permits targeted resource;
5. operation-specific constraints (sensitive path, command args, clean Git tree, etc.);
6. approval policy;
7. exact approval binding if approval is present.

Unknown operation => deny.

---

## 5. Approval model

### Direct calls

For operations with `approvalPolicy=always` or conditional policy that triggers:
- direct MCP does not execute;
- return `approval_required` with a safe explanation;
- caller creates/uses a governed Task approval flow.

Do not use `HOOSHIX_DIRECT_AUTO_APPROVE` in production HTTP. Migration can keep a test-only bypass under an explicit non-production configuration profile, but architecture tests should prevent production composition from wiring it.

### Task calls

Approval record binds:
- Task ID;
- Step ID;
- Tool/Operation ID;
- canonical action/argument fingerprint;
- requested workspace scope change if applicable;
- expiry;
- risk.

`runWithPolicyApproval` AsyncLocalStorage may be removed or reduced to transport convenience after exact application approval context is passed explicitly. Ambient async-local authorization must not be the core correctness boundary.

---

## 6. Workspace scope security

### Session-scoped direct context

HTTP session/principal workspace roots are not process-global. Stdio uses one explicit session context.

### Task scope

Task creation copies the current scope. Task execution/recovery always uses that persisted copy.

### Scope mutation rules

- add root outside current roots = expansion -> high-risk approval;
- replace roots with a strict subset may be lower risk but still authorized/audited;
- `unrestricted=true` requires all of:
  - production config explicitly allows unrestricted capability;
  - effective `ADMIN_MODE`;
  - explicit human approval for exact operation;
  - security audit event;
- no implicit unrestricted mode;
- no session workspace mutation can rewrite an existing Task scope.

---

## 7. Sensitive path policy

Implement one `SensitivePathPolicy` used by application file handlers.

Operations:
- `read_file`: reject sensitive path with `SENSITIVE_PATH_DENIED`.
- `search_files`: skip sensitive file/dir **before reading**; optionally count skipped entries in non-sensitive metadata.
- write/create/modify/delete/restore: deny sensitive targets by default; special ADMIN-only dedicated operation required if future need exists.
- list directory: may omit sensitive entries or list name-only according to explicit policy; do not expose secrets/content.

Search must skip `.env*`, `.token`, `.ssh`, known private-key files/dirs, cloud/provider credentials and configured patterns.

Property tests generate path variants, separators, casing/trailing segments and symlink fixtures.

---

## 8. Command authorization policy

### 8.1 General rule

`execute_command` is high risk. Unknown command/argument shapes default to `approval_required` or blocked, never auto-allowed because a subcommand name looks read-only.

### 8.2 Exact auto-allow patterns

Only exact harmless probes may be auto-allowed, e.g.:
- `node --version`
- package manager `--version`
- dedicated repo-scoped `git status`/`git log` should preferably use dedicated tools rather than generic execute command.

### 8.3 Git via generic command

For any auto-allow Git shape:
- cwd must be authorized repository root;
- reject `--no-index` for diff;
- reject output/redirection-like file options that can write outside scope;
- reject absolute path args unless explicitly authorized;
- pathspecs after `--` must canonicalize inside workspace;
- unknown flags => approval required.

Dedicated `git_diff` tool remains the preferred safe path.

### 8.4 Environment

Process environment is allowlisted/sanitized. Bootstrap/OAuth tokens, DB secrets and unrelated environment credentials are not inherited automatically.

---

## 9. Catalog/schema/handler completeness gate

CI test must assert for every `OperationId`/`ToolId`:

```text
Descriptor exists.
Inbound schema exists where externally callable.
Application use case/handler exists.
Permission/risk/approval come from descriptor only.
No duplicate hard-coded policy map exists.
Generated tool documentation includes it.
```

Also scan codebase for forbidden legacy definitions (`APPROVAL_TOOLS`, duplicate required-level maps, duplicated capability records) after cutover.

---

## 10. Security acceptance tests for this spec

1. READ_ONLY caller cannot mutate workspace roots.
2. PROJECT_ACCESS cannot set unrestricted.
3. DEVELOPER_MODE cannot set unrestricted without ADMIN + explicit approval.
4. Task with captured root A continues using A after direct session switches to B.
5. HTTP session A workspace change does not affect session B.
6. `.env`, `.token`, `.ssh/id_rsa` never read by search.
7. `git diff --no-index outsideA outsideB` is blocked/approval-required and produces no file content before approval.
8. shell cwd outside scope rejected for auto-approved command.
9. every direct high-risk tool returns approval-required instead of executing.
10. Task approved for tool X cannot execute tool Y under that approval.
11. modified arguments after approval fingerprint invalidates approval.
12. server permission ceiling cannot be exceeded by an OAuth token scope.
13. unknown tool/operation is denied, not default-admin-or-allow.
14. direct file tools expose and enforce SHA/idempotency semantics consistently with Task execution.