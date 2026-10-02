# HooshiX Database Migrations

Source of truth: `src/core/memory/database/migrations.ts` and `src/adapters/outbound/persistence/sqlite/base-schema.migration.ts`. `LATEST_MIGRATION_VERSION = 21`, pinned by `tests/core/r10-release-readiness.test.ts` so the constant cannot silently drift from the highest `migrate()` call.

## How migrations work

- A brand-new database gets `applyBaseSchemaMigration()` first (the v0 baseline), then `runMigrations()` walks 1..21.
- Each migration is idempotent: `migrate()` checks `schema_migrations` inside one transaction and returns immediately if already applied.
- Migrations run **once per process** (at first DB access), not per call.
- `foreign_keys` is ON. The fresh-DB path is asserted FK-clean end to end.

## Migration history

| Version | Name | Effect |
|---|---|---|
| 1 | legacy-columns-and-indexes | correlation_id/title columns + 13 indexes |
| 2 | tool-call-observability | completed_at, duration_ms, error + status index |
| 3 | package-snapshots | package snapshot table |
| 4 | normalize-task-states | `planned`→`planning`, `paused`→`waiting_approval` |
| 5 | metrics-indexes | metrics query indexes |
| 6 | workspace-persistence-v1 | `workspace_roots` |
| 7 | durable-task-contract-v1 | heartbeat, execution_context, retry_policy, idempotency_key, task_steps cols, `task_links` |
| 8 | observability-schema-v1 | tool_calls.category, recovery_events.task_id + indexes |
| 9 | r2-exact-task-approval-binding | approval_requests tool_id/fingerprint/principal/session/expires_at/dispatched_at |
| 10 | r3-canonical-task-aggregate-revision | tasks.task_revision |
| 11 | r3-durable-mutation-execution-receipts | `execution_receipts` |
| 12 | r3-durable-task-execution-lease | `task_leases` |
| 13 | r3-task-creation-request-hash | tasks.request_hash |
| 14 | r4-immutable-file-backup-snapshot | file_backups cols + sha256 backfill + `r4_backup_immutable` trigger |
| 15 | r4-canonical-project-identity | canonical_path/display_path, unique index, `PROJECT_CANONICAL_COLLISION` rollback |
| 16 | r5-oauth-credential-repository | oauth_access_tokens / refresh_tokens / revoked_families / registered_clients |
| 17 | r6-metrics-task-category-created-index | composite index for the metrics hot path |
| 18 | principal-owned-projects-and-memory | `principal_id` ownership on projects + memory, scoped reads |
| 19 | principal-owned-tasks | `principal_id` ownership on tasks + `idx_tasks_principal` |
| 20 | consolidate-canonical-task-states | rewrites legacy `created`→`planning`, `checkpointing`/`resuming`→`executing` so no row is left in a state the canonical `TaskState` union no longer admits |
| 21 | task-project-binding-and-memory-timestamps | nullable `tasks.project_id` + `idx_tasks_project_id` (a Task is owned directly by a Project; `task_list(projectId)` filters on it) and nullable `memory_items.updated_at` (records the last in-place change by `memory_update`) |

## Rehearsal

Before any release, run `node scripts/release-db-rehearsal.mjs`. It takes a real SQLite online `backup()` of the live DB, verifies integrity before and after, runs all migrations, and asserts task count is preserved, `foreign_key_check` is clean and `MAX(schema_migrations.version) === LATEST_MIGRATION_VERSION`. It then performs a restore drill on a second backup.

## Retention

`src/infrastructure/server/retention-scheduler.ts` runs `startPeriodicRetention` at startup and every 6 hours (default; an `unref`'d timer, non-overlapping ticks). `HOOSHIX_RETENTION_DAYS` (default 90; `0` disables). The retention policy is class-aware: active checkpoints, in-flight recovery evidence, pending approvals and unrestored backups are preserved.

## Failure behavior

A migration failure must block startup — no silent catch-and-ignore drift. A healthy production database never reaches an intermediate schema silently: unrelated databases are not healed by migration (asserted by `tests/core/r6-migration-only-schema.test.ts`).
