# Target Architecture — Full Hexagonal Architecture + Clean Architecture

**Status:** normative target architecture  
**Owner directive:** mandatory full-project adoption  
**Primary architectural source:** Alistair Cockburn, Ports & Adapters / Hexagonal Architecture.  
**Clean Architecture rule used:** dependencies point inward toward policy; infrastructure/framework details are replaceable outer mechanisms.

---

## 1. Architectural objective

The final HooshiX source tree must express an enforceable inside/outside boundary:

```text
                     INBOUND / DRIVING ADAPTERS
          MCP stdio | MCP HTTP | monitoring HTTP | tests
                           |
                           v
                 +---------------------+
                 |  APPLICATION PORTS  |
                 |  + USE CASES        |
                 +---------------------+
                           |
             +-------------+-------------+
             |                           |
             v                           v
       DOMAIN MODEL              OUTBOUND PORTS
  task/tool/security rules     repositories, FS,
  state/value objects          process, Git, clock,
  invariants/events            tokens, metrics, audit
             |                           |
             +-------------+-------------+
                           |
                           v
                    OUTBOUND ADAPTERS
         SQLite | Node FS | execa | Git | package managers
          JSONL | Prometheus | crypto | in-memory sessions

                     INFRASTRUCTURE / BOOTSTRAP
           config + composition root + server process startup
```

The application must be runnable in tests with in-memory/fake adapters and without MCP SDK, SQLite, actual filesystem, actual subprocesses, or network transport.

---

## 2. Final layer responsibilities

### 2.1 `src/domain/`

Contains pure business/workflow concepts and invariants.

Allowed:
- TypeScript language types/classes/functions;
- domain entities, value objects, enums/unions, domain errors, pure policies;
- deterministic state transitions;
- pure template/state/idempotency semantics where no I/O is needed.

Forbidden:
- `node:*` imports;
- MCP SDK;
- Zod;
- `better-sqlite3`;
- execa;
- filesystem/path/process/environment access;
- timers/system clock directly;
- UUID/random generation directly;
- logging/metrics;
- concrete repositories.

Proposed areas:

```text
src/domain/
  shared/
    result.ts
    errors.ts
    ids.ts
  task/
    task.ts
    task-step.ts
    task-state.ts
    task-policy.ts
    retry-policy.ts
    execution-outcome.ts
    execution-receipt.ts
    reconciliation.ts
    idempotency.ts
    template-model.ts
  tool/
    tool-id.ts
    tool-risk.ts
    tool-effect.ts
    tool-descriptor.ts
    permission.ts
  workspace/
    workspace-scope.ts
    authorized-path.ts
    path-sensitivity.ts
  approval/
    approval.ts
    approval-state.ts
  backup/
    file-backup.ts
    package-snapshot.ts
    git-snapshot.ts
  auth/
    principal.ts
    scope.ts
    token-metadata.ts
```

### 2.2 `src/application/`

Contains application orchestration, use cases, authorization policy and all ports.

Allowed:
- imports from `domain/**`;
- imports from `application/**`;
- application DTOs/contracts;
- interfaces for external capabilities.

Forbidden:
- direct imports from `adapters/**` or `infrastructure/**`;
- `node:*`, MCP SDK, Zod, execa, better-sqlite3;
- raw SQL;
- `process.env`;
- concrete global workspace state.

Proposed areas:

```text
src/application/
  ports/
    inbound/
    outbound/
  use-cases/
    tools/
    tasks/
    workspace/
    approvals/
    auth/
    monitoring/
    recovery/
  services/
    authorization-service.ts
    workspace-access-policy.ts
    tool-catalog.ts
    tool-dispatcher.ts
    task-runner.ts
    reconciliation-service.ts
    compensation-service.ts
  dto/
  policy/
```

### 2.3 `src/adapters/inbound/`

Technology-specific drivers that translate external requests into application commands.

Examples:

```text
src/adapters/inbound/
  mcp/
    common/
      tool-schema-registry.ts
      tool-response-mapper.ts
    stdio/
      mcp-stdio.adapter.ts
    http/
      mcp-http.adapter.ts
      session.adapter.ts
    tools/
      filesystem-tools.adapter.ts
      task-tools.adapter.ts
      system-tools.adapter.ts
      ...
  http/
    oauth-routes.adapter.ts
    monitoring-routes.adapter.ts
    health-routes.adapter.ts
```

Rules:
- inbound adapters depend on application use cases/ports;
- they do not import outbound adapters;
- they do not contain authorization policy beyond translating principal/transport context;
- Zod/MCP SDK/HTTP request parsing belong here;
- direct MCP tools and task MCP tools may have separate transport mappings, but both must call the same application use cases.

### 2.4 `src/adapters/outbound/`

Concrete implementations of application-owned outbound ports.

```text
src/adapters/outbound/
  persistence/sqlite/
    sqlite-connection.ts
    migrations/
    mappers/
    repositories/
  filesystem/node/
    node-filesystem.adapter.ts
    node-path.adapter.ts
  process/execa/
    execa-process.adapter.ts
  git/
    git.adapter.ts
  package/
    npm.adapter.ts
    pnpm.adapter.ts
    pip.adapter.ts
    winget.adapter.ts
    choco.adapter.ts
  audit/
    jsonl-audit.adapter.ts
    sqlite-security-events.adapter.ts
  metrics/
    prometheus.adapter.ts
    in-memory-mcp-metrics.adapter.ts
  auth/
    token-repository.sqlite.adapter.ts
    crypto-token.adapter.ts
  clock/
    system-clock.adapter.ts
  identity/
    uuid.adapter.ts
  rate-limit/
    token-bucket.adapter.ts
```

Rules:
- adapters implement ports; they do not contain workflow policy;
- adapters may provide defense-in-depth checks but must not decide application authorization;
- raw SQL is permitted only under `adapters/outbound/persistence/sqlite/**`;
- filesystem/process libraries stay here.

### 2.5 `src/infrastructure/`

Runtime assembly/configuration/operational wiring only.

```text
src/infrastructure/
  config/
    env-config.ts
    config-schema.ts
    effective-config-log.ts
  composition/
    application-composition.ts
    adapter-composition.ts
  server/
    http-server.ts
    stdio-server.ts
  lifecycle/
    startup.ts
    shutdown.ts
    retention-scheduler.ts
```

Infrastructure may import inward and instantiate adapters. It must not own task/security business rules.

### 2.6 `src/bootstrap/`

Tiny executable entry points:

```text
src/bootstrap/index.ts
src/bootstrap/index-http.ts
```

Responsibilities:
- load validated config;
- create composition root;
- initialize/migrate DB;
- run startup reconciliation;
- start selected inbound adapter;
- register graceful shutdown.

No tool rules, OAuth protocol logic, SQL or direct filesystem operations in bootstrap.

---

## 3. Dependency rule

### 3.1 Allowed compile-time directions

```text
Domain <- Application <- Inbound Adapters
Domain <- Application <- Outbound Adapters
Domain <- Application <- Infrastructure/Composition -> Adapters
Bootstrap -> Infrastructure/Composition
```

A port is owned by the layer that needs the capability, not by the adapter that implements it.

### 3.2 Forbidden directions

- Domain -> Application
- Domain -> Adapters/Infrastructure
- Application -> Adapters/Infrastructure
- Inbound Adapter -> Outbound Adapter
- Outbound Adapter -> Inbound Adapter
- Domain/Application -> MCP SDK, Zod, execa, better-sqlite3, Node FS/process/env
- Any non-SQLite-adapter module -> raw SQL
- Any non-config/bootstrap module -> `process.env`

---

## 4. Core architectural flows

### 4.1 Direct MCP tool call

```text
MCP transport
 -> principal/session mapper
 -> MCP schema validation
 -> ExecuteToolUseCase
    -> ToolCatalog lookup
    -> AuthorizationService
    -> WorkspaceAccessPolicy / command policy
    -> approval requirement evaluation
    -> specific application ToolHandler
       -> outbound port(s)
    -> execution receipt + audit/metrics ports
 -> response mapper
```

There is no direct MCP -> `NodeFileSystemAdapter`, `ExecaProcessAdapter`, `GitAdapter`, `PackageAdapter`, or SQLite repository path.

### 4.2 Durable Task step

```text
RunTaskUseCase
 -> acquire TaskExecutionLeasePort
 -> TaskRepository.load (canonical aggregate)
 -> TaskRunner
    -> state/dependency/template policy
    -> ExecuteToolUseCase   <--- SAME gateway as direct MCP
    -> ExecutionReceipt
    -> checkpoint/repository/trace ports
    -> unknown-outcome reconciliation gate
 -> release/renew lease
```

This removes the current direct-vs-task execution duplication.

### 4.3 Workspace mutation

```text
MCP task/direct request
 -> ExecuteToolUseCase
 -> ToolDescriptor(set_workspace)
 -> AuthorizationService
    required permission: DEVELOPER/ADMIN policy
    expansion/unrestricted: ADMIN + explicit approval + server allow flag
 -> WorkspaceContextRepository
```

Direct workspace context is keyed by principal/session. A task persists a copied immutable `WorkspaceScope` at creation time. Changing a user's current direct workspace cannot change an existing Task's scope.

### 4.4 HTTP OAuth

```text
HTTP OAuth route adapter
 -> OAuth application use case
    -> authorization-code/token repositories
    -> ClockPort + CryptoTokenPort
 -> response mapper

HTTP MCP request
 -> bearer extractor
 -> ValidateAccessTokenUseCase
 -> Principal
 -> MCP inbound adapter
 -> application use cases
```

The bootstrap secret is never returned as an OAuth access token.

---

## 5. Central use-case boundaries

The target application must expose a small set of meaningful inbound ports/use cases rather than one interface per function.

Required core use cases:

- `ExecuteToolUseCase`
- `CreateTaskUseCase`
- `RunTaskUseCase`
- `ResumeTaskUseCase`
- `ApproveTaskUseCase`
- `CancelTaskUseCase`
- `AppendTaskStepsUseCase`
- `ReconcileStepOutcomeUseCase`
- `GetTaskReportUseCase`
- `ManageWorkspaceUseCase`
- `IssueAuthorizationCodeUseCase`
- `ExchangeAuthorizationCodeUseCase`
- `RefreshTokenUseCase`
- `ValidateAccessTokenUseCase`
- `GetMetricsUseCase`
- `RunRetentionUseCase`

Tool-specific application handlers may exist behind `ExecuteToolUseCase`, but the transports do not call them directly.

---

## 6. Tool execution model

Define one pure `ToolDescriptor` per `ToolId`:

```ts
interface ToolDescriptor {
  id: ToolId;
  requiredPermission: PermissionLevel;
  risk: ToolRisk;
  approval: "never" | "on-risk" | "always" | "admin-and-approval";
  effect: "read_only" | "idempotent_mutation" | "non_idempotent_mutation";
  workspaceScope: "none" | "read" | "write" | "scope_mutation" | "process";
  supportsIdempotency: boolean;
  capabilities: readonly string[];
}
```

This metadata is application/domain policy. The MCP Zod schema is an adapter concern but must be exhaustive for every `ToolId` and tested against the catalog.

`ExecuteToolUseCase` returns a typed application result:

```ts
type ToolExecutionResult =
  | { kind: "succeeded"; output: unknown; receipt?: ExecutionReceipt }
  | { kind: "approval_required"; approvalRequestId: string }
  | { kind: "blocked"; reason: string }
  | { kind: "failed"; error: ApplicationError }
  | { kind: "outcome_unknown"; receipt: ExecutionReceipt; reason: string };
```

Application callers must handle all cases exhaustively.

---

## 7. Authorization architecture

Authorization is a single application service, not a collection of adapter calls.

Inputs:
- `Principal` / actor identity;
- server permission ceiling;
- OAuth scopes where applicable;
- `ToolDescriptor`;
- operation arguments after schema validation;
- immutable `WorkspaceScope`;
- task/step/approval context;
- server security config (`allowUnrestricted`, direct approval policy).

Outputs:

```ts
interface AuthorizationDecision {
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
  effectivePermission: PermissionLevel;
  constraints: AuthorizationConstraints;
}
```

No adapter may override an application denial.

Recommended effective authorization model:

```text
effective authority = min(server permission ceiling, principal token scopes/role)
                      + workspace scope constraints
                      + tool risk/approval policy
                      + operation-specific constraints
```

`unrestricted` scope expansion requires:
- server `allowUnrestricted=true`;
- ADMIN effective permission;
- explicit human approval bound to the exact requested scope mutation;
- audit event.

There must be no production equivalent of `HOOSHIX_DIRECT_AUTO_APPROVE=1` that silently bypasses this for HTTP. If a local test/development bypass remains, it must live in a development adapter/config profile and be impossible in production mode.

---

## 8. Process isolation/security boundary

The architecture must not falsely claim that a child process is sandboxed by workspace path validation. `ProcessRunnerPort` represents an OS-account process boundary.

Application policy must enforce:
- authorized cwd;
- strict executable allowlist;
- argv execution, never shell strings;
- sanitized environment allowlist that excludes MCP/bootstrap/token secrets by default;
- timeout and output limits;
- command-specific safe-pattern policy for any auto-approved command;
- code-evaluation/package/script forms require approval;
- absolute/path-bearing arguments validated when the operation is classified safe/auto-approved;
- unknown command forms default to approval_required or blocked.

If true OS/container sandboxing is introduced later, it is another `ProcessRunnerPort` adapter; application policy does not change.

---

## 9. Task execution and side-effect truth model

Exactly-once execution across OS/network/filesystem/package/Git effects is not promised.

Domain states must distinguish:
- `succeeded`
- `failed_known`
- `blocked`
- `approval_required`
- `outcome_unknown`
- `reconciled_succeeded`
- `reconciled_failed`

For non-idempotent mutations, `outcome_unknown` blocks retry until `ReconcileStepOutcomeUseCase` returns a known decision.

A timeout is a cancellation request plus termination handshake, not proof that the external effect did not happen.

A process crash while a side-effecting step is `running` becomes `outcome_unknown` on recovery unless an idempotency receipt proves a safe replay.

---

## 10. Persistence architecture

Application owns repository interfaces such as:
- `TaskRepository`
- `ApprovalRepository`
- `ExecutionLeaseRepository`
- `ExecutionTraceRepository`
- `RecoveryEventRepository`
- `FileBackupRepository`
- `PackageSnapshotRepository`
- `ProjectRepository`
- `OAuthTokenRepository`
- `WorkspaceContextRepository`

SQLite implements them in outbound adapters.

There must be:
- one canonical domain mapper per aggregate;
- migrations only in one adapter-owned migration subsystem;
- no repository-local ALTER fallback;
- no partial crash-recovery hydration;
- no SQL in inbound adapters.

---

## 11. Observability architecture

Application emits structured events to ports:

- `AuditPort`
- `MetricsPort`
- `TracePort`
- `SecurityEventPort`

Business outcome and telemetry outcome are separate.

For a successful side effect followed by telemetry failure:
- the business result remains successful/known;
- system health records `observability_degraded`;
- a fallback error is emitted without secrets;
- unsafe automatic retry is not triggered merely because logging failed.

---

## 12. Architecture enforcement test requirements

CI must fail for forbidden imports. At minimum write a Vitest architecture test that scans static import specifiers.

Examples:

- files under `src/domain/` may import only relative files under `src/domain/`;
- files under `src/application/` may import only `src/application/` and `src/domain/`;
- no `node:` import in domain/application;
- no `@modelcontextprotocol/sdk` outside `src/adapters/inbound/mcp/`;
- no `better-sqlite3` outside `src/adapters/outbound/persistence/sqlite/`;
- no `execa` outside process/Git/package outbound adapters;
- no `process.env` outside `src/infrastructure/config/` or bootstrap;
- no `withAgentDatabase` legacy helper after cutover;
- no raw SQL tokens (`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `CREATE TABLE`, `ALTER TABLE`) in inbound/application/domain sources except test fixtures.

Also add a catalog completeness test:

```text
Every ToolId has exactly:
- one ToolDescriptor;
- one input schema;
- one application handler;
- one authorization policy entry derived from descriptor;
- regression coverage for its declared effect/scope class.
```

---

## 13. Architecture success criteria

The full redesign is accepted only when:

- direct MCP and Task execution meet at `ExecuteToolUseCase` before any side effect;
- Domain/Application compile without infrastructure/framework imports;
- current `core/executor/handlers -> services/*` concrete dependency is gone;
- current `TaskRuntimeService -> task-repository/workspace-guard` concrete dependency is gone;
- current `closed-agent-loop -> concrete persistence/observability` imports are gone;
- raw task SQL in `tools/task/index.ts` is gone;
- global mutable workspace guard is gone;
- concrete adapter construction occurs in composition/bootstrap only;
- old duplicate tool definitions are removed;
- architecture boundary tests pass in CI.

The target is architectural behavior, not merely achieving a new directory layout.