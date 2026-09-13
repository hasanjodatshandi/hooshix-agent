# Application Use Cases Specification

Application use cases are the only API that inbound adapters may invoke. They coordinate domain rules and outbound ports without knowing MCP/HTTP/SQLite/Node details.

---

## 1. `ExecuteToolUseCase`

### Purpose

Single unavoidable gateway for **both** direct MCP tool calls and durable Task steps.

### Input

```ts
interface ExecuteToolCommand {
  principal: Principal;
  toolId: ToolId;
  arguments: unknown;
  correlationId: CorrelationId;
  taskContext?: {
    taskId: TaskId;
    stepId: StepId;
    workspaceScope: WorkspaceScope;
    approvedActionFingerprint?: string;
  };
  directContext?: {
    sessionId: SessionId;
  };
  abortSignal?: AbortSignalLike;
}
```

`AbortSignalLike` is an application-owned minimal interface/type if needed; do not import Node-specific process APIs.

### Flow

1. Lookup canonical `ToolDescriptor`.
2. Validate arguments via `ToolInputValidatorPort`.
3. Resolve effective workspace scope:
   - task context -> immutable persisted scope;
   - direct context -> principal/session workspace repository.
4. Evaluate `AuthorizationService`.
5. If blocked -> emit security event and return blocked.
6. If approval required and no matching approved task action -> return `approval_required`; never perform side effect.
7. Resolve operation-specific authorized paths/command constraints.
8. Dispatch to one application tool handler.
9. Capture `ExecutionReceipt`/outcome.
10. Emit audit/metrics/trace events without allowing telemetry failure to rewrite known business outcome.
11. Return typed result.

No inbound adapter may call a tool handler directly.

---

## 2. Task use cases

### 2.1 `CreateTaskUseCase`

Responsibilities:
- enforce plan size/step bounds;
- validate explicit tool IDs and arguments through shared validator port;
- validate dependencies/templates/runWhen;
- canonicalize request for idempotency hash;
- enforce same-key/same-hash semantics;
- capture immutable current WorkspaceScope from principal/session context;
- create Task aggregate;
- persist through `TaskRepository`;
- emit task-created trace/memory event.

No global workspace read.

### 2.2 `RunTaskUseCase`

Responsibilities:
- acquire durable execution lease atomically;
- load Task via canonical repository mapper;
- validate state/retry budgets;
- invoke `TaskRunner`;
- renew lease heartbeat while running;
- release lease on known completion or controlled failure;
- persist resulting aggregate and trace events;
- never auto-retry non-idempotent unknown outcomes.

### 2.3 `ResumeTaskUseCase`

Responsibilities:
- load approval + Task canonically;
- validate approval state and exact task/step/action binding before consumption;
- consume approval atomically once;
- acquire task lease;
- resume only the exact approved step through `TaskRunner`/`ExecuteToolUseCase`;
- never allow stale approvals to resurrect cancelled/completed tasks.

### 2.4 `ApproveTaskUseCase`

Responsibilities:
- load approval;
- reject not-found/revoked/consumed/expired;
- reject if Task terminal/cancelled;
- validate principal is authorized to approve that risk/scope;
- mark approved atomically;
- audit approval decision.

### 2.5 `CancelTaskUseCase`

Rules:
- if an external effect is currently executing, cancellation requests abort but do not falsely claim the effect did not happen;
- revoke pending/unconsumed approvals;
- if step becomes unknown, Task enters reconciling rather than false clean cancellation;
- terminal no-op behavior explicit.

### 2.6 `AppendTaskStepsUseCase`

Default final contract:
- may append only to `failed` Tasks that have no unresolved `outcome_unknown` step, unless an explicit `ReopenTaskUseCase` is later added;
- `completed` and `cancelled` => reject with `TASK_TERMINAL`;
- appended step dependencies/runWhen validated;
- plan revision increments.

This resolves current success-but-unrunnable behavior.

### 2.7 `ReconcileStepOutcomeUseCase`

Input:
- Task/Step ID;
- reconciliation evidence from tool-specific reconciler or explicit operator decision.

Output:
- confirmed succeeded;
- confirmed failed;
- safe to retry;
- still unknown;
- manual intervention required.

It must be impossible for ordinary `task_run` to turn unknown non-idempotent state into pending without this use case.

### 2.8 `GetTaskReportUseCase`

Builds report from:
- canonical Task aggregate;
- TraceRepository;
- RecoveryRepository;
- MetricsPort/query service.

No raw SQL. Report clearly exposes:
- current state;
- unknown/reconciliation requirements;
- attempts/history;
- recovery/approval timeline;
- telemetry degraded flags.

---

## 3. Workspace use cases

### 3.1 `SetWorkspaceUseCase`

Uses the same authorization service/tool descriptor as `ExecuteToolUseCase` if exposed as a tool.

Rules:
- path canonicalized through port;
- scope mutation applies to the caller's session context only;
- adding a root is a scope expansion and policy-relevant operation;
- `unrestricted=true` requires server enable flag + effective ADMIN + exact human approval;
- no implicit unrestricted mode;
- existing Task scopes unchanged.

### 3.2 `RemoveWorkspaceRootUseCase`

Rules:
- session-scoped;
- cannot leave an invalid active root without deterministic fallback/error;
- cannot alter persisted Task scope;
- authorization/audit required.

### 3.3 `ReplaceWorkspaceRootsUseCase`

Treat as scope mutation. Expansion requires stronger approval; narrowing may be lower risk but still authorized/audited.

### 3.4 `GetWorkspaceUseCase`

Read-only; returns session workspace state and server unrestricted capability, not hidden global process state.

---

## 4. OAuth/auth use cases

### 4.1 `IssueAuthorizationCodeUseCase`

Input:
- authenticated/verified operator authorization decision;
- client ID;
- redirect URI;
- PKCE challenge/method;
- resource;
- requested scopes.

Rules:
- only S256;
- redirect/client/resource validated by adapter/application policy;
- code random/high entropy, one-time, 5-minute lifetime;
- stored via `AuthorizationCodeStorePort` (raw value not logged).

### 4.2 `ExchangeAuthorizationCodeUseCase`

Rules:
- consume code once atomically;
- verify PKCE;
- verify redirect/client/resource exact binding;
- issue a distinct random access token, not bootstrap secret;
- persist **hash** and metadata;
- one-hour access TTL unless configuration chooses a stricter policy;
- issue rotating refresh token family.

### 4.3 `RefreshTokenUseCase`

Rules:
- validate token hash + client/resource;
- reject expired/revoked/consumed token;
- atomically mark consumed and create next-generation refresh token;
- replay of consumed refresh token revokes/locks the token family according to policy;
- issue fresh access token with bounded lifetime.

### 4.4 `ValidateAccessTokenUseCase`

Rules:
- hash presented token and lookup constant-time where practical;
- reject expired/revoked;
- validate intended resource/audience;
- validate scopes;
- return Principal;
- invalid/expired -> 401 mapping in adapter;
- insufficient scope -> 403 mapping.

---

## 5. Monitoring/health use cases

### `GetMetricsUseCase`

- authorized monitoring principal/scope;
- pagination/time filters validated;
- no sensitive secret output;
- data obtained through metrics/query ports;
- Prometheus text rendering remains an adapter concern.

### Health

Liveness/readiness are infrastructure health checks rather than domain use cases.

- `/health/live`: process alive, minimal response.
- `/health/ready`: migrations initialized, DB reachable, startup reconciliation not in fatal state; minimal non-sensitive fields.

No master token in URLs.

---

## 6. Retention use case

`RunRetentionUseCase` receives retention policy config and repositories/maintenance port.

Requirements:
- explicit policy per table/data class;
- operational telemetry retention separate from durable task/business history;
- periodic scheduling from infrastructure;
- transactional batches;
- metrics on deleted rows/duration/failures;
- no silent deletion of active approvals, active leases or unresolved backups.

---

## 7. Application tool handlers

A handler implements an application interface, not an inbound adapter:

```ts
interface ApplicationToolHandler<I = unknown, O = unknown> {
  toolId: ToolId;
  execute(ctx: AuthorizedToolContext, input: I): Promise<ExecutionOutcome<O>>;
}
```

Examples:
- `ReadFileHandler` -> `FileSystemPort`.
- `SearchFilesHandler` -> `WorkspaceAccessPolicy` + `FileSystemPort`, skip sensitive files before read and enforce aggregate byte budget.
- `WriteFileHandler` -> backup repository + FileSystemPort + revisions/idempotency.
- `ExecuteCommandHandler` -> `ProcessRunnerPort` after command policy.
- `GitDiffHandler` -> `GitPort`; generic command safe policy must not substitute for dedicated tool rules.
- `InstallPackageHandler` -> PackageManagerPort + manifest snapshot/reconciliation.

Handlers never import Node FS/execa/SQLite.

---

## 8. Error model

Use application/domain error codes rather than string matching:

Required categories include:
- `VALIDATION_ERROR`
- `PERMISSION_DENIED`
- `APPROVAL_REQUIRED`
- `SECURITY_POLICY`
- `WORKSPACE_SCOPE_VIOLATION`
- `SENSITIVE_PATH_DENIED`
- `IDEMPOTENCY_CONFLICT`
- `PRECONDITION_FAILED`
- `TASK_TERMINAL`
- `TASK_LEASE_CONFLICT`
- `OUTCOME_UNKNOWN`
- `RECONCILIATION_REQUIRED`
- `TOKEN_INVALID`
- `TOKEN_EXPIRED`
- `TOKEN_SCOPE_INSUFFICIENT`
- `RATE_LIMITED`
- `DEPENDENCY_UNAVAILABLE`
- `TELEMETRY_DEGRADED` (flag/health, not necessarily primary operation failure).

Inbound adapters map these to MCP/HTTP responses; use cases do not know HTTP status codes.

---

## 9. Transaction boundaries

Application use cases specify atomic requirements but do not call SQLite transactions directly.

Repository ports should expose atomic methods such as:
- `createTaskIfIdempotencyMatches(...)`;
- `tryAcquireLease(...)`;
- `approveIfPending(...)`;
- `consumeApprovalIfExactMatch(...)`;
- `rotateRefreshToken(...)`;
- `saveTaskAndStepTransition(...)` where atomicity is needed.

Avoid a generic application `TransactionManager` unless concrete use cases truly require composing multiple repositories atomically. Prefer intention-revealing repository operations.

---

## 10. Use-case acceptance rule

A use case is considered migrated only when:
- all direct infrastructure imports are absent;
- in-memory fake adapter tests prove behavior;
- corresponding SQLite/FS/process integration tests prove adapter behavior;
- inbound MCP/HTTP E2E proves mapping;
- old direct path is no longer externally reachable.