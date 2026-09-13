# Ports Contracts Specification

All ports are owned by the application layer. This document defines the minimum contracts needed to remove concrete infrastructure dependencies from the current core.

---

## 1. Persistence ports

### 1.1 `TaskRepository`

```ts
interface TaskRepository {
  create(task: Task): Promise<void>;
  get(taskId: TaskId): Promise<Task | null>;
  list(limit: number): Promise<TaskSummary[]>;
  save(task: Task): Promise<void>;
  saveTransition(input: TaskTransitionPersistence): Promise<void>;
  findByIdempotencyKey(key: IdempotencyKey): Promise<{ task: Task; requestHash: Sha256 } | null>;
  findInterruptedTaskIds(): Promise<TaskId[]>;
  updateHeartbeat(taskId: TaskId, at: Instant): Promise<void>;
}
```

Rules:
- `get` is the **only canonical aggregate hydration path**.
- `findInterruptedTaskIds` returns IDs/minimal metadata only; caller then uses `get`.
- no second partial Task mapper.
- repository preserves all retry/runWhen/attempt/template/idempotency/execution-scope fields.

### 1.2 `ApprovalRepository`

Required atomic methods:

```ts
interface ApprovalRepository {
  create(approval: Approval): Promise<ApprovalId>;
  get(id: ApprovalId): Promise<Approval | null>;
  approveIfPending(id: ApprovalId, principalId: PrincipalId, at: Instant): Promise<boolean>;
  consumeIfExact(input: ExactApprovalConsume): Promise<boolean>;
  revokeForTask(taskId: TaskId, at: Instant): Promise<number>;
  expireBefore(at: Instant): Promise<number>;
}
```

`consumeIfExact` must condition on task + step + tool + action fingerprint + approved state + not expired.

### 1.3 `ExecutionLeaseRepository`

```ts
interface ExecutionLeaseRepository {
  tryAcquire(input: AcquireLease): Promise<ExecutionLease | null>;
  renew(input: RenewLease): Promise<boolean>;
  release(input: ReleaseLease): Promise<boolean>;
  get(taskId: TaskId): Promise<ExecutionLease | null>;
}
```

Atomicity is mandatory. SQLite adapter implementation is specified in document 13.

### 1.4 Other repositories

Required separate ports:
- `CheckpointRepository`
- `ExecutionTraceRepository`
- `RecoveryEventRepository`
- `FileBackupRepository`
- `PackageSnapshotRepository`
- `ProjectRepository`
- `WorkspaceContextRepository`
- `OAuthTokenRepository`

Do not create a generic CRUD repository base class. Each contract should expose domain-intent operations.

---

## 2. Workspace and filesystem ports

### 2.1 `PathCanonicalizerPort`

```ts
interface PathCanonicalizerPort {
  resolve(path: string, base?: CanonicalPath): Promise<CanonicalPath>;
  realpathNearestExisting(path: CanonicalPath): Promise<CanonicalPath>;
  exists(path: CanonicalPath): Promise<boolean>;
  isDirectory(path: CanonicalPath): Promise<boolean>;
  relative(from: CanonicalPath, to: CanonicalPath): string;
}
```

This port abstracts OS path/realpath behavior. Application `WorkspaceAccessPolicy` owns authorization decisions.

### 2.2 `FileSystemPort`

Use authorized/canonical paths, not user raw paths.

```ts
interface FileSystemPort {
  readText(path: AuthorizedPath, maxBytes: number): Promise<FileReadResult>;
  stat(path: AuthorizedPath): Promise<FileStat>;
  list(path: AuthorizedPath, limits: DirectoryListLimits): Promise<DirectoryEntry[]>;
  walk(root: AuthorizedPath, limits: WalkLimits): AsyncIterable<FileWalkEntry>;
  atomicWrite(path: AuthorizedPath, content: Uint8Array, mode?: number): Promise<FileWriteReceipt>;
  createExclusive(path: AuthorizedPath, content: Uint8Array, mode?: number): Promise<FileWriteReceipt>;
  delete(path: AuthorizedPath): Promise<FileMutationReceipt>;
  revision(path: AuthorizedPath): Promise<Sha256 | null>;
}
```

The adapter must preserve atomic write/fsync/exclusive-create controls.

Search logic belongs in application handler so it can apply sensitive-path and aggregate-byte policy before every read.

---

## 3. Process port

### `ProcessRunnerPort`

```ts
interface ProcessRunnerPort {
  execute(input: AuthorizedProcessCommand): Promise<ProcessExecutionOutcome>;
  terminate(executionId: ExecutionId, graceMs: number): Promise<TerminationResult>;
}
```

`AuthorizedProcessCommand` is produced by application policy and includes:
- executable;
- argv array;
- authorized cwd;
- sanitized env map;
- timeout/output budgets;
- correlation/execution IDs.

Adapter guarantees:
- `shell:false` equivalent;
- no command string concatenation;
- output caps;
- process-tree cancellation where supported;
- termination result is explicit: terminated/completed/unknown.

Application timeout logic must await `terminate` result before deciding if outcome is known.

---

## 4. Git port

```ts
interface GitPort {
  status(scope: AuthorizedGitRepository, options?: GitStatusOptions): Promise<GitStatus>;
  diff(scope: AuthorizedGitRepository, request: GitDiffRequest): Promise<GitDiffResult>;
  log(scope: AuthorizedGitRepository, request: GitLogRequest): Promise<GitLogEntry[]>;
  clone(request: AuthorizedGitClone): Promise<GitMutationReceipt>;
  add(scope: AuthorizedGitRepository, paths: AuthorizedPathspec[]): Promise<GitMutationReceipt>;
  commit(scope: AuthorizedGitRepository, message: string): Promise<GitCommitReceipt>;
  branch(scope: AuthorizedGitRepository, name: GitBranchName): Promise<GitMutationReceipt>;
  checkout(scope: AuthorizedGitRepository, target: GitRef): Promise<GitMutationReceipt>;
  head(scope: AuthorizedGitRepository): Promise<GitObjectId>;
  resetHard(scope: AuthorizedGitRepository, commit: GitObjectId): Promise<GitMutationReceipt>;
  cleanUntracked(scope: AuthorizedGitRepository): Promise<GitMutationReceipt>;
}
```

`GitDiffRequest` for the dedicated safe Git tool must not represent `--no-index`. Generic process commands are governed separately.

Git adapter remains argv-separated and validates refs/pathspec encoding defensively.

---

## 5. Package manager port

Use a manager abstraction only where semantics are genuinely common.

```ts
interface PackageManagerPort {
  manager: PackageManagerId;
  install(request: AuthorizedPackageOperation): Promise<PackageOperationReceipt>;
  remove(request: AuthorizedPackageOperation): Promise<PackageOperationReceipt>;
  update(request: AuthorizedPackageOperation): Promise<PackageOperationReceipt>;
  inspectManifestState(scope: AuthorizedPath): Promise<PackageManifestState>;
}
```

A separate `PackageManifestSnapshotRepository` persists manifest snapshots.

Do not expose a generic `rollback()` that implies full environment reversal unless the adapter actually supports and verifies it.

---

## 6. Tool input validation port

Application must not import Zod.

```ts
interface ToolInputValidatorPort {
  validate<T = unknown>(toolId: ToolId, input: unknown): ValidationResult<T>;
}
```

The MCP adapter's Zod schema registry may implement this port or share its schema definitions with a validator adapter. Completeness is tested against every ToolId.

Validation runs at both untrusted inbound boundaries and Task execution/hydration boundaries where persisted data may be old/corrupt.

---

## 7. Audit, security events, trace and metrics ports

### 7.1 `AuditPort`

```ts
interface AuditPort {
  record(event: AuditEvent): Promise<AuditWriteResult>;
}
```

Contract: failure to record a **post-effect** audit event cannot change a known successful side-effect outcome into `failed`. Caller receives a degradation signal.

### 7.2 `SecurityEventPort`

Events:
- authentication success/failure;
- authorization denial/approval requirement;
- approval decision/consume/revoke;
- sensitive-path denial;
- rate-limit event;
- token refresh replay/revocation;
- scope expansion attempts;
- execution outcome unknown/reconciliation.

Never include secret values/file content.

### 7.3 `TracePort`

```ts
interface TracePort {
  executionStarted(...): Promise<void>;
  executionCompleted(...): Promise<void>;
  decisionRecorded(...): Promise<void>;
  recoveryRecorded(...): Promise<void>;
}
```

### 7.4 `MetricsPort`

Application emits semantic counters/timers; Prometheus rendering is adapter-specific.

No metric label may contain secret/user-provided unbounded values. Tool IDs/status enums are bounded labels.

---

## 8. Clock/random/token ports

### `ClockPort`

```ts
interface ClockPort {
  now(): Instant;
}
```

Used for deterministic OAuth, lease, approval, retention and timeout policy tests.

### `IdGeneratorPort`

Generates UUID-style IDs for Task/execution/correlation as required.

### `TokenGeneratorPort`

```ts
interface TokenGeneratorPort {
  generateOpaque(bytes: number): SecretToken;
  hashOpaque(token: SecretToken): TokenHash;
  constantTimeEqual(a: TokenHash, b: TokenHash): boolean;
}
```

Raw token handling must be minimized and never logged.

---

## 9. OAuth/token repository port

```ts
interface OAuthTokenRepository {
  storeAccessToken(record: AccessTokenRecord): Promise<void>;
  findAccessTokenByHash(hash: TokenHash): Promise<AccessTokenRecord | null>;
  revokeAccessToken(tokenId: TokenId, at: Instant): Promise<void>;
  createRefreshFamily(record: RefreshTokenRecord): Promise<void>;
  rotateRefreshToken(input: RefreshRotationRequest): Promise<RefreshRotationResult>;
  revokeRefreshFamily(familyId: RefreshFamilyId, at: Instant): Promise<void>;
  cleanupExpired(before: Instant): Promise<TokenCleanupResult>;
}
```

`rotateRefreshToken` must be atomic and distinguish first valid use from replay of a consumed generation.

---

## 10. Rate limiter port

```ts
interface RateLimiterPort {
  consume(key: RateLimitKey, policy: RateLimitPolicy, now: Instant): Promise<RateLimitDecision>;
  releaseConcurrency?(key: RateLimitKey, classId: string): Promise<void>;
}
```

Recommended keys:
- OAuth public endpoints: IP + endpoint;
- authenticated MCP: principal/token ID + IP;
- expensive tool concurrency: principal + tool class.

Default adapter can be in-memory for the current one-process deployment. Architecture allows replacement later without changing use cases.

---

## 11. Workspace context repository

```ts
interface WorkspaceContextRepository {
  get(sessionId: SessionId): Promise<WorkspaceScope>;
  set(sessionId: SessionId, scope: WorkspaceScope): Promise<void>;
  remove(sessionId: SessionId): Promise<void>;
}
```

For stdio, composition can create one stable local session ID. For HTTP, each authenticated/logical session has its own context. Tasks store a copied `WorkspaceScope` in Task persistence.

---

## 12. Port testing contract

Every outbound port implementation must have:
- an adapter contract/integration test;
- at least one in-memory/fake adapter for application tests where useful;
- identical error classification semantics at the port boundary;
- no policy decisions hidden inside an adapter response.

Do not mock implementation details of SQLite/execa in application tests; fake the port instead. Test real adapters separately.