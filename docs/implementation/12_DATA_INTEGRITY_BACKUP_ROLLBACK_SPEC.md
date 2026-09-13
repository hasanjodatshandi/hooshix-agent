# Data Integrity, Backup, Restore & Compensation Specification

**Primary findings:** HIGH-08, HIGH-09, MED-07, MED-10, MED-11, MED-12; supports HIGH-05/HIGH-06 and MED-06.  
**Architecture:** Domain defines truthful state/guarantees; Application owns compensation policy and ports; adapters perform concrete FS/Git/package operations.

---

## 1. Non-negotiable integrity principles

1. Never call an operation `rollback` unless the system can prove the documented pre-state is restored.
2. A backup is an immutable snapshot description; restoration history is separate mutable metadata.
3. Every mutable file backup records an absolute canonical target, previous-state kind, pre-revision, and the post-mutation revision when known.
4. Restoring an old snapshot over newer content requires an explicit revision check; silent overwrite is forbidden.
5. Git rollback is allowed only when the snapshot contract can reconstruct the promised state. Initial redesign contract: **clean repository required**.
6. Package compensation is **manifest compensation** unless a manager-specific adapter proves installed-environment reversal.
7. Side-effect uncertainty after timeout/crash is handled by execution reconciliation, not by optimistic compensation.
8. Direct MCP and Task paths use the same compensation use cases and repositories.

---

## 2. Domain types

### 2.1 File backup

```ts
type PreviousFileState =
  | { kind: "absent" }
  | { kind: "present"; revision: Sha256; size: number };

interface FileBackupSnapshot {
  id: BackupId;
  target: CanonicalPath;
  previousState: PreviousFileState;
  contentRef?: BackupContentRef;
  createdAt: Instant;
  createdBy: PrincipalId;
  correlationId: CorrelationId;
  sourceExecutionId?: ExecutionId;
  postMutationRevision?: Sha256;
}

interface RestoreRecord {
  id: RestoreId;
  backupId: BackupId;
  startedAt: Instant;
  completedAt?: Instant;
  result: "succeeded" | "failed" | "outcome_unknown";
  displacedBackupId?: BackupId;
  forceHistorical: boolean;
}
```

`previousState` is immutable. Never encode `absent` using `restored_at` or another mutable field.

### 2.2 Git snapshot

```ts
interface GitSnapshot {
  id: GitSnapshotId;
  repository: CanonicalPath;
  head: GitObjectId;
  branch?: GitBranchName;
  cleanliness: "clean";
  createdAt: Instant;
}
```

The initial production contract intentionally has no `dirty` variant. A future ADR may introduce complete dirty-tree capture, but until then snapshot creation rejects dirty repositories.

### 2.3 Package manifest snapshot

```ts
interface PackageManifestSnapshot {
  id: PackageSnapshotId;
  manager: PackageManagerId;
  workspace: CanonicalPath;
  files: readonly ManifestSnapshotEntry[];
  createdAt: Instant;
}

type PackageCompensationResult =
  | { kind: "manifest_restored"; verifiedFiles: readonly CanonicalPath[] }
  | { kind: "manifest_restore_failed"; errors: readonly CompensationError[] }
  | { kind: "environment_restored"; evidence: readonly VerificationEvidence[] };
```

`environment_restored` is legal only for an adapter that performs and verifies a real installed-state reversal.

---

## 3. File mutation protocol

For write/modify/delete/create:

1. Authorize canonical target.
2. Deny sensitive target according to `SensitivePathPolicy`.
3. Read/compute current revision/state.
4. Validate `ifMatchSha256` when supplied/required.
5. Persist immutable pre-mutation backup metadata/content.
6. Perform atomic mutation.
7. Compute post-mutation revision when target exists.
8. Update snapshot with post-mutation revision in a dedicated immutable/append-only field if schema design permits; otherwise persist a mutation receipt linked to backup.
9. Persist execution receipt.
10. Audit/metrics failure after step 8 must not convert known mutation success to failed.

For `create_file` on absent target, the backup snapshot is `{kind:"absent"}` with no fake empty-file content semantics.

---

## 4. Restore protocol

### 4.1 Normal immediate compensation

Default `restore_file` behavior:

1. Load immutable snapshot.
2. Re-authorize the exact stored absolute canonical target against current principal/task scope.
3. Deny sensitive target unless a dedicated elevated policy explicitly permits it.
4. Inspect current target state/revision.
5. If snapshot has `postMutationRevision`, require current revision to equal it.
6. If revision mismatches: return `RESTORE_REVISION_CONFLICT`; no write/delete occurs.
7. Capture a displaced backup of the current state before restore.
8. Apply snapshot:
   - previous absent -> delete current target if present;
   - previous present -> atomic write exact prior content.
9. Verify final state/revision equals snapshot previous state.
10. Record RestoreRecord.

### 4.2 Historical/force restore

A user-requested historical overwrite is distinct from automatic compensation:
- high-risk operation;
- explicit approval;
- captures displaced backup;
- `forceHistorical=true` recorded;
- exact target and snapshot ID bound into approval fingerprint.

### 4.3 Repeated restore

Restoring the same snapshot multiple times is deterministic:
- if already at expected previous state, return idempotent success/no-op;
- never reinterpret an absent snapshot as empty-present because restoration metadata changed.

---

## 5. File backup content storage

Initial SQLite implementation may store content in DB for current project scale, but the port must not require that choice.

Requirements:
- max backed-up content bounded by existing file limits;
- content hash persisted;
- binary-safe representation even if current tool surface is text-oriented;
- no backup contents written to audit logs;
- retention distinguishes restored disposable backups from unresolved compensation evidence;
- unresolved/outcome-unknown backups are never deleted by generic age cleanup without policy.

If content-addressed deduplication is added later, it requires an ADR and integrity verification; it is not required for the first redesign release.

---

## 6. Git snapshot/rollback contract

### Snapshot

`CreateGitSnapshotUseCase`:
1. authorize repository path;
2. dedicated Git adapter obtains status;
3. if any tracked/index/untracked change exists -> reject `GIT_DIRTY_SNAPSHOT_UNSUPPORTED`;
4. store repository canonical path, HEAD, branch, clean state.

### Rollback

`RollbackGitSnapshotUseCase`:
1. high-risk + exact approval;
2. snapshot repository must equal authorized canonical repository;
3. verify snapshot HEAD is valid full object ID;
4. optional current-state safety check can require no unknown external operation in progress;
5. run `reset --hard <head>` and `clean -fd` only under the explicit clean-snapshot guarantee;
6. verify resulting HEAD/status matches snapshot.

The API text must say: **restores repository to a previously captured clean Git snapshot**. It must not promise reconstruction of arbitrary dirty work.

---

## 7. Package compensation contract

### 7.1 Before operation

Capture manager-appropriate manifest set:
- npm: `package.json`, lock/shrinkwrap when present;
- pnpm: `package.json`, `pnpm-lock.yaml`;
- pip/project: explicit supported manifest set defined by adapter;
- winget/choco: no file snapshot can imply environment rollback.

### 7.2 On failed/unknown operation

Do not automatically declare rollback success.

Options:
- known command failure before mutation -> no compensation required;
- known manifest mutation -> restore manifests, verify hashes, return `manifest_restored`;
- installed-state may have changed -> task remains known failed with `environmentReconciliationRequired=true`, unless manager adapter can inspect/prove target state;
- unknown process outcome -> follow task reconciliation spec before any retry.

### 7.3 Naming/API

Rename current ambiguous `package_restore` behavior to `package_manifest_restore` in application/domain terminology. If backward-compatible MCP alias remains temporarily, its description must state manifest-only semantics and be deprecated.

---

## 8. Project path canonical identity

`ProjectRepository` stores:
- `canonical_path` as unique identity;
- optional `display_path` for user-facing original spelling.

Canonicalization rules are delegated to `PathCanonicalizerPort`, then application uses returned identity consistently.

Migration must:
1. compute canonical identity for every existing project;
2. detect collisions before unique index creation;
3. produce a migration report for collisions;
4. fail closed rather than silently merging memory/task ownership;
5. require explicit collision resolution in migration tooling if data differ.

Windows case/separator semantics must be covered by adapter tests on Windows CI or platform-specific fixtures.

---

## 9. Schema requirements

Detailed SQL belongs to document 13. Required logical fields:

### `file_backups`
- `id`
- `target_canonical_path`
- `previous_state` (`absent|present`)
- `previous_revision`
- `post_mutation_revision`
- `content_blob` or content ref
- `content_hash`
- `created_at`
- `source_execution_id`
- `correlation_id`

### `file_restores`
- restore attempt/result history, separate from snapshot type.

### `projects`
- unique `canonical_path`; optional display path.

### `package_snapshots`
- explicit snapshot type/version and compensation capability (`manifest_only` by default).

---

## 10. Mandatory tests

1. Create absent file -> restore -> absent; repeat same restore -> still absent.
2. Restore present file -> exact previous bytes/revision.
3. Mutation followed by intervening edit -> normal restore rejected with revision conflict.
4. Force historical restore requires approval and produces displaced backup.
5. Restore uses stored absolute target even after direct workspace changes.
6. Restore outside current authorized scope is denied even if backup exists.
7. Backup content never appears in audit events.
8. Dirty Git repository snapshot is rejected before any destructive command.
9. Clean Git snapshot -> mutation -> rollback -> exact HEAD and clean status restored.
10. Package operation failure + manifest change -> manifest restored and result named `manifest_restored`, not generic rolled_back.
11. winget/choco adapter cannot emit full rollback success without verification evidence.
12. Equivalent project paths resolve to one canonical identity; migration collision fixture fails explicitly.
13. File CAS/idempotency behavior is identical through direct MCP and Task gateway.
14. Crash between external effect and Task completion does not cause compensation/retry to run without reconciliation.

---

## 11. Definition of done

- HIGH-08/HIGH-09 and MED-07/10/11/12 tests pass.
- No mutable column encodes immutable backup snapshot type.
- No restore resolves target relative to live global workspace state.
- No Git rollback can run from a snapshot that did not prove clean pre-state.
- No package result says full rollback unless installed-state reversal is verified.
- User-facing docs precisely distinguish automatic compensation, historical restore, Git clean snapshot rollback, and package manifest restore.