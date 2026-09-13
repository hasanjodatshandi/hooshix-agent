# Persistence Schema & Migration Specification

**Primary findings:** HIGH-07, HIGH-13, MED-07, MED-08, MED-10, MED-11, MED-12, MED-17, MED-18, MED-20; supports HIGH-04 and architecture MED-26/28.  
**Database strategy:** retain SQLite for the current single-agent deployment, but move every persistence concern behind application-owned ports and a single outbound SQLite adapter.

---

## 1. Persistence rules

1. Raw SQL exists only under `src/adapters/outbound/persistence/sqlite/**` and migrations.
2. Application/domain never imports better-sqlite3 or SQLite types.
3. There is one canonical Task mapper/hydrator used by normal reads, reporting and crash recovery.
4. Schema evolution happens only through versioned migrations. Repository-local `ALTER TABLE` fallback/catch-ignore logic is forbidden after cutover.
5. Migrations are transactional when SQLite permits; destructive/data-transform migrations require preflight and backup.
6. Migration code must be idempotent by version, not by swallowing errors.
7. Retention policy is explicit per table and never inferred from generic timestamps.
8. All identities that require logical equivalence use persisted canonical keys, not transient comparison only.
9. Every durable idempotency record binds key + canonical request/effect hash.
10. Execution lease acquisition/renew/release is atomic at the database boundary.

---

## 2. Target persistence modules

```text
src/adapters/outbound/persistence/sqlite/
  sqlite-database.ts
  transaction.ts
  migrations/
    0001_baseline-import.ts
    0002_task-completeness.ts
    0003_execution-leases.ts
    0004_idempotency-hashes.ts
    0005_file-backup-integrity.ts
    0006_project-canonical-path.ts
    0007_oauth-issued-tokens.ts
    0008_retention-and-indexes.ts
    ...
  mappers/
    task.mapper.ts
    approval.mapper.ts
    backup.mapper.ts
    oauth-token.mapper.ts
    project.mapper.ts
  repositories/
    sqlite-task.repository.ts
    sqlite-approval.repository.ts
    sqlite-execution-lease.repository.ts
    sqlite-checkpoint.repository.ts
    sqlite-trace.repository.ts
    sqlite-recovery.repository.ts
    sqlite-file-backup.repository.ts
    sqlite-project.repository.ts
    sqlite-package-snapshot.repository.ts
    sqlite-oauth-token.repository.ts
    sqlite-workspace-context.repository.ts
```

Migration numbers may differ from existing DB versioning, but the logical sequence is normative.

---

## 3. Baseline migration strategy for current dirty repository

Do not recreate the database from scratch in production migration.

Implementation assistant must:
1. inspect current migration/version table and schema from a **copy** of the live/local DB;
2. create a schema inventory artifact before edits;
3. map existing columns to target domain fields;
4. preserve current task/approval/execution/audit/history records unless an explicit migration rule says otherwise;
5. create backup copy before first new migration;
6. test upgrade from at least:
   - a fresh empty DB;
   - a representative current DB copy;
   - fixtures missing optional/legacy columns from older migration states where supported;
7. never test destructive migration against the original user DB.

---

## 4. Canonical Task persistence model

The persisted Task aggregate must contain all semantics needed after restart.

### Task-level required fields

- `id`
- `title`, `description`
- state/status
- correlation ID
- canonical creation request hash / idempotency key
- execution scope snapshot + schema/version
- retry policy serialized in structured columns/JSON with version
- max recovery policy
- total run count
- created/updated/heartbeat timestamps
- plan revision/version

### Step-level required fields

- task ID + step ID unique
- action
- tool/operation ID
- current arguments
- original/template arguments
- dependencies
- `run_when`
- timeout
- status
- attempt counts
- failure counts
- attempt history/provenance
- output/error/error type
- effect class
- execution ID / receipt reference
- idempotency key/hash when applicable
- reconciliation state
- timestamps/revision

### Mapper rule

`TaskMapper.fromRows(...)` is the single reconstruction implementation. `TaskRepository.get(id)` uses it. `findInterruptedTaskIds()` may query IDs/states only and must never build a second partial Task object.

Add a full semantic round-trip test with all non-default fields populated.

---

## 5. Execution lease schema

```text
execution_leases
  task_id TEXT PRIMARY KEY
  owner_id TEXT NOT NULL
  lease_token_hash TEXT NOT NULL
  acquired_at INTEGER/TEXT NOT NULL
  heartbeat_at INTEGER/TEXT NOT NULL
  expires_at INTEGER/TEXT NOT NULL
  version INTEGER NOT NULL
```

Requirements:
- lease token is random and treated as secret-ish capability; hash or non-loggable opaque identifier preferred;
- acquire uses one atomic INSERT/UPSERT transaction with `expires_at < now` condition;
- renew/release require exact task + owner + lease token identity;
- index `expires_at` for stale cleanup/recovery;
- concurrent process test proves exactly one winner.

SQLite WAL's one-writer behavior is retained, but it is not the execution-lock correctness mechanism.

---

## 6. Task and tool idempotency schema

### Task creation

```text
tasks.idempotency_key
 tasks.request_hash
 tasks.creation_scope_hash
```

Unique on non-null task idempotency key. Application behavior:
- same key + same request/scope contract -> existing task;
- same key + different hash -> conflict.

### Tool/effect idempotency

Prefer a dedicated table:

```text
idempotency_records
  id
  namespace              -- task/tool operation domain
  idempotency_key
  operation_id
  arguments_hash
  scope_hash
  principal_or_task_id
  execution_id
  status                  -- running|succeeded|failed_known|outcome_unknown
  result_ref
  receipt_ref
  created_at
  updated_at
UNIQUE(namespace, idempotency_key)
```

Replay of unknown/running must not start a second effect.

---

## 7. File backup/restore migrations

Target fields described in document 12.

Migration from overloaded current `restored_at='absent'` model:
1. add `previous_state` nullable;
2. classify legacy rows:
   - exact legacy absent marker -> `previous_state='absent'`;
   - all other valid backups -> `present`;
3. introduce proper `restored_at` timestamp semantics separately;
4. add canonical absolute target field;
5. add pre/post revision and content hash where historical data permits;
6. legacy rows lacking post-mutation revision are marked `legacy_unversioned` and require explicit historical/force restore rather than unsafe automatic compensation;
7. add `file_restores` history table.

Do not silently invent revisions for legacy rows.

---

## 8. Project canonical-path migration

Target:

```text
projects
  ...
  display_path
  canonical_path UNIQUE NOT NULL
```

Preflight migration:
- compute canonical values with the same production path adapter logic;
- detect collisions;
- output collision report with IDs/paths only, no file contents;
- migration refuses to add unique constraint while unresolved collisions exist.

Provide explicit migration helper command or documented manual resolution procedure for collisions.

---

## 9. OAuth token persistence

See document 10. Required tables or equivalent normalized structures:

- access tokens: hash, client, principal, resource/audience, scopes, issued/expiry/revoked;
- refresh token families/generations: hash, family, generation, consumed/revoked/expiry/rotated_to;
- authorization codes if durability/multi-process requires shared storage;
- dashboard sessions if retained server-side.

Indexes:
- unique token hashes;
- access expires_at/revoked_at;
- refresh family+generation;
- refresh expires_at;
- optional principal/client cleanup indexes.

Raw tokens never persisted.

---

## 10. Retention model

Define retention classes, not one blanket 90-day rule.

### Operational telemetry
Examples: tool calls, completed executions, recovery events, security events. Configurable retention, periodic cleanup.

### Durable workflow history
Tasks/steps/memory may have product-specific longer retention or explicit archive/delete. Do not auto-delete merely because telemetry retention is 90 days.

### Security credentials
Expired/revoked access/refresh codes cleaned after a bounded forensic grace according to policy.

### Backups/snapshots
- restored superseded backups: age-based cleanup allowed after minimum grace;
- unresolved/outcome-unknown evidence: preserve until resolved or explicit operator action;
- package snapshots: retain per task/reconciliation policy.

### Idempotency records
Retain long enough to cover retry/replay window; cleanup must not permit a late duplicate request to execute unexpectedly while clients still reasonably retry.

`RunRetentionUseCase` receives table-class policy and invokes repository cleanup operations. Infrastructure scheduler runs periodically and optionally once at startup.

---

## 11. Index strategy

Do not add speculative indexes blindly.

Mandatory/strong candidates based on audited query shapes:
- task status/updated/heartbeat where startup recovery/listing uses them;
- `tool_calls(created_at)` for recent ordering/time filters;
- composites matching actual frequent filters only after EXPLAIN evidence;
- `recovery_events(started_at)` for time-bounded metrics;
- token `expires_at` indexes;
- lease `expires_at`;
- canonical project path unique;
- idempotency unique key;
- existing useful status/tool/correlation indexes preserved.

Document query plan evidence in document 14 benchmark results before adding large composite index sets.

---

## 12. Schema integrity and failure behavior

- migration failure aborts startup in production mode;
- no `catch { /* ignore */ }` around migration/schema drift;
- compatibility adapters may recognize known old versions and produce actionable error;
- DB file backup failure before risky migration blocks migration;
- foreign keys remain enabled;
- busy timeout/WAL retained;
- migrations never log sensitive row contents.

---

## 13. Database backup and restore for migration

Before migration requiring data transform:
1. close/quiesce writes or use SQLite-supported consistent backup mechanism;
2. produce timestamped backup outside source tree/generated secret paths;
3. verify backup opens and `PRAGMA integrity_check`/equivalent passes;
4. record schema version/checksum metadata;
5. run migration;
6. run post-migration integrity and application repository tests.

Rollback strategy is **restore database backup**, not down-migration that risks partial reverse transforms, unless a migration explicitly provides a tested safe down path.

---

## 14. Mandatory migration tests

1. Empty DB -> latest schema.
2. Current representative DB copy -> latest schema with row counts/semantic Task equality.
3. Full Task round-trip including retry/runWhen/attempt/template/idempotency/scope.
4. Interrupted-task ID query + canonical get preserves full Task.
5. Two OS processes race lease acquire -> one success.
6. Same task idempotency key/different hash -> conflict.
7. Legacy absent backup migrates to immutable previous_state.
8. Legacy unversioned restore cannot silently automatic-compensate over new content.
9. Project canonical collision fixture blocks migration with explicit report.
10. OAuth refresh rotation atomic under concurrent calls.
11. Retention deletes only intended classes and preserves unresolved evidence.
12. Actual production metrics queries have expected EXPLAIN plans at target benchmark row counts.
13. Startup fails on intentionally corrupted/unsupported migration instead of silently continuing.
14. DB backup restore returns pre-migration schema/data in a disposable fixture.

---

## 15. Definition of done

- no raw SQL outside SQLite adapter/migrations;
- no per-call `PRAGMA table_info` schema introspection;
- canonical Task mapper is singular and recovery uses it;
- leases/idempotency/backup/project/OAuth migrations exist and are tested;
- periodic retention is explicit by data class;
- current useful WAL/FK/busy-timeout controls preserved;
- representative DB upgrade succeeds from a safe copy;
- migration procedure is documented in operations/cutover docs.