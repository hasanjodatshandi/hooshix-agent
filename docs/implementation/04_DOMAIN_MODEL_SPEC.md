# Domain Model Specification

The Domain layer is pure. It defines HooshiX's workflow, authorization-relevant descriptors, execution truth and compensation concepts without knowing MCP, HTTP, SQLite, Node, Zod, execa or filesystem APIs.

---

## 1. Core aggregates and entities

### 1.1 `Task`

Required fields/concepts:

```ts
interface Task {
  id: TaskId;
  title: string;
  description?: string;
  state: TaskState;
  correlationId: CorrelationId;
  steps: TaskStep[];
  executionScope: WorkspaceScope;
  retryPolicy: RetryPolicy;
  totalRunCount: number;
  idempotency?: TaskIdempotency;
  createdAt: Instant;
  updatedAt: Instant;
}
```

Invariants:
- step IDs unique and stable;
- dependencies point only to existing steps;
- cyclic dependencies rejected;
- terminal task semantics explicit;
- Task cannot silently reopen from `completed`/`cancelled` by append;
- execution scope captured at Task creation and immutable unless an explicit administrative migration/revision use case exists;
- persisted retry policy and counters never disappear on hydration.

### 1.2 `TaskStep`

```ts
interface TaskStep {
  id: StepId;
  action: string;
  toolId: ToolId;
  arguments: unknown;
  originalTemplateArguments?: unknown;
  dependencies: StepId[];
  runWhen: RunWhen;
  timeoutMs: number;
  state: StepState;
  attempts: number;
  failedAttempts: number;
  attemptHistory: AttemptRecord[];
  idempotencyKey?: IdempotencyKey;
  lastReceipt?: ExecutionReceipt;
  output?: unknown;
  error?: DomainErrorSnapshot;
}
```

`toolId` is required in the final model. The current heuristic `ToolSelector` fallback from action text must not silently choose a tool for persisted execution. If action-to-tool suggestion remains as a planning helper, it is outside the authoritative execution model and requires explicit resolution before Task creation.

### 1.3 `Approval`

```ts
interface Approval {
  id: ApprovalId;
  taskId: TaskId;
  stepId: StepId;
  toolId: ToolId;
  actionFingerprint: string;
  state: "pending" | "approved" | "consumed" | "revoked" | "expired";
  risk: ToolRisk;
  requestedAt: Instant;
  approvedAt?: Instant;
  expiresAt?: Instant;
}
```

Invariants:
- approval bound to exact task, step, tool and action fingerprint;
- consumed once;
- cancelled/terminal Task revokes outstanding approvals;
- scope-expansion approval binds exact requested workspace roots/unrestricted value;
- an approval for one tool cannot authorize another through async-local leakage.

---

## 2. State models

### 2.1 Task states

Recommended final set:

```ts
type TaskState =
  | "planning"
  | "ready"
  | "executing"
  | "waiting_approval"
  | "reconciling"
  | "recovering"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled";
```

`outcome_unknown` belongs primarily to step execution outcome; Task may enter `reconciling` when one or more steps are unknown.

Terminal states:
- `completed`
- `cancelled`

`failed` is not automatically reopened by ordinary run if a non-idempotent unknown outcome exists; reconciliation rules apply.

### 2.2 Step states

```ts
type StepState =
  | "pending"
  | "running"
  | "pending_approval"
  | "blocked"
  | "succeeded"
  | "failed"
  | "outcome_unknown"
  | "reconciled_succeeded"
  | "reconciled_failed"
  | "skipped"
  | "cancelled";
```

Do not overload `cancelled` to mean conditionally skipped. Use `skipped` explicitly.

### 2.3 Run conditions

```ts
type RunWhen = "success" | "failure" | "always";
```

Semantics must be pure and testable. Recovery hydration must preserve `runWhen` exactly.

---

## 3. Execution truth model

### 3.1 `ToolEffect`

```ts
type ToolEffect =
  | "read_only"
  | "idempotent_mutation"
  | "non_idempotent_mutation";
```

Examples:
- `read_file`, `git_status`: read_only.
- write with strong idempotency key/revision: idempotent_mutation.
- arbitrary command, package install, Git commit: non_idempotent_mutation unless a specific reconciler proves otherwise.

### 3.2 `ExecutionOutcome`

```ts
type ExecutionOutcome<T> =
  | { kind: "succeeded"; value: T; receipt: ExecutionReceipt }
  | { kind: "failed_known"; error: DomainErrorSnapshot; receipt?: ExecutionReceipt }
  | { kind: "outcome_unknown"; reason: string; receipt: ExecutionReceipt };
```

A timeout is not a `failed_known` outcome until termination and relevant side-effect state are known.

### 3.3 `ExecutionReceipt`

```ts
interface ExecutionReceipt {
  executionId: ExecutionId;
  toolId: ToolId;
  effect: ToolEffect;
  startedAt: Instant;
  finishedAt?: Instant;
  idempotencyKey?: IdempotencyKey;
  preconditionRevision?: Revision;
  postconditionRevision?: Revision;
  externalReference?: string;
  termination: "completed" | "terminated" | "unknown";
}
```

Receipts support reconciliation but do not falsely assert exactly-once execution.

---

## 4. Reconciliation model

```ts
type ReconciliationDecision =
  | { kind: "confirmed_succeeded"; evidence: string }
  | { kind: "confirmed_failed"; evidence: string }
  | { kind: "safe_to_retry"; evidence: string }
  | { kind: "still_unknown"; reason: string }
  | { kind: "manual_intervention_required"; reason: string };
```

Rules:
- read-only steps may generally be retried after crash if no output was persisted;
- idempotent mutations may retry only when the idempotency contract is durable and verified;
- non-idempotent mutations never auto-retry from unknown outcome;
- a Task with unknown non-idempotent effect enters `reconciling` and exposes this to caller/reporting.

---

## 5. Idempotency model

### 5.1 Task request idempotency

```ts
interface TaskIdempotency {
  key: IdempotencyKey;
  requestHash: Sha256;
}
```

Rules:
- same key + same canonical request hash => return existing Task;
- same key + different request hash => explicit conflict;
- hash covers title/description/steps/tool IDs/arguments/retry policy/execution-scope-relevant request fields as defined by application canonicalizer.

### 5.2 Tool effect idempotency

Idempotency support is tool-specific and declared in `ToolDescriptor`.

An idempotency record must bind:
- tool ID;
- canonical arguments hash;
- execution scope identity;
- principal/task identity where relevant;
- effect result/receipt.

Reusing a key with different payload/scope is a conflict, not a cache hit.

---

## 6. Tool descriptor domain model

```ts
type PermissionLevel =
  | "READ_ONLY"
  | "PROJECT_ACCESS"
  | "DEVELOPER_MODE"
  | "ADMIN_MODE";

type ToolRisk = "low" | "medium" | "high" | "critical";

type ApprovalPolicy =
  | "never"
  | "conditional"
  | "always"
  | "admin_and_approval";

type WorkspaceBehavior =
  | "none"
  | "read"
  | "write"
  | "process"
  | "scope_mutation";

interface ToolDescriptor {
  id: ToolId;
  requiredPermission: PermissionLevel;
  risk: ToolRisk;
  approvalPolicy: ApprovalPolicy;
  effect: ToolEffect;
  workspaceBehavior: WorkspaceBehavior;
  supportsIdempotency: boolean;
  capabilities: readonly string[];
}
```

No independent permission/risk list may exist elsewhere. Adapter schemas may contain descriptions but not redefine policy.

---

## 7. Workspace model

### 7.1 `WorkspaceScope`

```ts
interface WorkspaceScope {
  activeRoot: CanonicalPath;
  allowedRoots: readonly CanonicalPath[];
  unrestricted: boolean;
  scopeVersion: number;
}
```

Rules:
- paths canonicalized before identity comparison;
- direct-call scope belongs to principal/session, not process global;
- Task scope is copied/persisted at Task creation;
- `unrestricted=true` is never implicit;
- unrestricted requires server support + ADMIN + explicit approval;
- changing session scope cannot mutate existing Task scope.

### 7.2 `AuthorizedPath`

Application path policy returns an opaque/pure value representing a path already checked for:
- allowed root containment;
- realpath/symlink escape rules;
- read/write capability;
- sensitive-path policy.

Outbound filesystem adapter accepts authorized/canonical paths from application. It may re-canonicalize as defense in depth but does not decide user authorization.

---

## 8. Sensitive-path model

Sensitive-path classifications are explicit policy values, not scattered filename checks.

Categories:
- environment secrets (`.env*`);
- HooshiX bootstrap/token files (`.token` etc.);
- SSH/private key areas (`.ssh`, common key extensions);
- cloud/provider credentials;
- package/auth credential files (`.npmrc`, pip/netrc equivalents where secrets may be stored);
- configured organization-specific sensitive patterns.

Default behavior:
- direct ordinary read/search: deny/skip according to operation contract;
- write/mutation: deny unless explicitly supported by an ADMIN-only specialized use case;
- generic process: sensitive access is not claimed to be sandboxed; process execution policy/approval is the boundary.

`search_files` must never read a sensitive file merely to decide whether its content matches.

---

## 9. Backup/compensation domain models

### 9.1 File backup

```ts
interface FileBackup {
  id: BackupId;
  absolutePath: CanonicalPath;
  previousState: "absent" | "present";
  content?: Uint8ArrayDomainRepresentation;
  preRevision?: Sha256;
  postMutationRevision?: Sha256;
  createdAt: Instant;
  restoredAt?: Instant;
}
```

`previousState` is immutable. `restoredAt` never encodes snapshot type.

### 9.2 Git snapshot

```ts
interface GitSnapshot {
  id: SnapshotId;
  repositoryRoot: CanonicalPath;
  head: GitObjectId;
  branch?: string;
  precondition: "clean_tree";
  createdAt: Instant;
}
```

Until a full dirty-state snapshot feature exists, dirty tree snapshot creation is invalid.

### 9.3 Package snapshot

Name the domain concept truthfully:

```ts
interface PackageManifestSnapshot {
  id: SnapshotId;
  manager: PackageManagerId;
  files: ManifestFileSnapshot[];
  createdAt: Instant;
}
```

A manifest restore result is not called full environment rollback.

---

## 10. Principal/auth domain model

```ts
interface Principal {
  id: PrincipalId;
  kind: "local_stdio" | "oauth_client" | "operator";
  permissionCeiling: PermissionLevel;
  scopes: readonly OAuthScope[];
  sessionId?: SessionId;
}
```

Authorization applies both server configuration and principal authority. HTTP tokens never implicitly grant more than server policy permits.

OAuth access token metadata includes:
- token ID (not raw token);
- client ID;
- principal ID;
- resource/audience;
- scopes;
- issuedAt;
- expiresAt;
- revokedAt.

Refresh token family includes rotation generation/replay state.

---

## 11. Time and identifiers

Domain represents time as a simple immutable value/string/epoch type but does not call `Date.now()` directly in policy that needs deterministic tests. Application receives `ClockPort`.

UUID/random/token generation belongs to outbound ports/adapters.

---

## 12. Domain tests required

Pure tests must cover:
- all valid/invalid task state transitions;
- runWhen semantics;
- terminal append/reopen rules;
- task idempotency hash conflict semantics;
- ToolDescriptor completeness/invariants;
- workspace scope mutation rules;
- unrestricted preconditions;
- approval binding/consume/revoke rules;
- outcome_unknown retry rules by ToolEffect;
- file backup repeated restore semantics at model level;
- Git clean-tree precondition;
- compensation result terminology;
- token expiry/scopes/resource metadata rules with supplied clock values.

Domain tests must require no SQLite, filesystem, subprocess or network.