import type Database from "better-sqlite3";
import {createHash} from "node:crypto";
import path from "node:path";
import { canonicalProjectPath } from "../../../infrastructure/project-path-identity.js";

const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Highest migration version applied by runMigrations. Exported so release
 tooling (scripts/release-db-rehearsal.mjs) asserts a migrated copy reaches the
 * CURRENT head instead of a hardcoded version that silently rots as new
 * migrations land. If you add a migration, bump this to match it.
 */
export const LATEST_MIGRATION_VERSION = 24;

export function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  if (!SAFE_IDENTIFIER.test(table) || !SAFE_IDENTIFIER.test(column)) {
    throw new Error(`Invalid table or column name: ${table}.${column}`);
  }
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }


}

export function migrate(
  db: Database.Database,
  version: number,
  name: string,
  operation: () => void,
): void {
  const applied = db.prepare("SELECT 1 FROM schema_migrations WHERE version = ?").get(version);
  if (applied) return;
  db.transaction(() => {
    operation();
    db.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)")
      .run(version, name, new Date().toISOString());
  })();


}

export function runMigrations(db: Database.Database): void {
  migrate(db, 1, "legacy-columns-and-indexes", () => {
    ensureColumn(db, "tasks", "correlation_id", "TEXT");
    ensureColumn(db, "tasks", "title", "TEXT");
    ensureColumn(db, "executions", "task_id", "TEXT");
    ensureColumn(db, "executions", "status", "TEXT NOT NULL DEFAULT 'completed'");
    ensureColumn(db, "executions", "correlation_id", "TEXT");
    ensureColumn(db, "decisions", "correlation_id", "TEXT");
    ensureColumn(db, "approval_requests", "action", "TEXT");
    ensureColumn(db, "approval_requests", "consumed_at", "TEXT");
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_correlation_id ON tasks(correlation_id);
      CREATE INDEX IF NOT EXISTS idx_executions_task_id ON executions(task_id);
      CREATE INDEX IF NOT EXISTS idx_executions_correlation_id ON executions(correlation_id);
      CREATE INDEX IF NOT EXISTS idx_decisions_correlation_id ON decisions(correlation_id);
      CREATE INDEX IF NOT EXISTS idx_checkpoints_task_id ON agent_checkpoints(task_id, id);
      CREATE INDEX IF NOT EXISTS idx_checkpoints_correlation_id ON agent_checkpoints(correlation_id);
      CREATE INDEX IF NOT EXISTS idx_approvals_correlation_id ON approval_requests(correlation_id);
      CREATE INDEX IF NOT EXISTS idx_recovery_correlation_id ON recovery_events(correlation_id, id);
      CREATE INDEX IF NOT EXISTS idx_recovery_id ON recovery_events(recovery_id, id);
      CREATE INDEX IF NOT EXISTS idx_tool_calls_correlation_id ON tool_calls(correlation_id, id);
      CREATE INDEX IF NOT EXISTS idx_task_steps_task_order ON task_steps(task_id, step_order);
      CREATE INDEX IF NOT EXISTS idx_memory_items_task_id ON memory_items(task_id, id);
      CREATE INDEX IF NOT EXISTS idx_file_backups_path ON file_backups(path, created_at);
    `);
  });

  migrate(db, 2, "tool-call-observability", () => {
    ensureColumn(db, "tool_calls", "completed_at", "TEXT");
    ensureColumn(db, "tool_calls", "duration_ms", "INTEGER");
    ensureColumn(db, "tool_calls", "error", "TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_tool_calls_tool_status ON tool_calls(tool, status)");
  });

  migrate(db, 3, "package-snapshots", () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS package_snapshots (
        id TEXT PRIMARY KEY,
        correlation_id TEXT NOT NULL,
        manager TEXT NOT NULL,
        action TEXT NOT NULL,
        package_name TEXT NOT NULL,
        cwd TEXT NOT NULL,
        snapshot TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        restored_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_package_snapshots_correlation ON package_snapshots(correlation_id, created_at);
    `);
  });

  migrate(db, 4, "normalize-task-states", () => {
    db.prepare("UPDATE tasks SET status = 'planning' WHERE status = 'planned'").run();
    db.prepare("UPDATE tasks SET status = 'waiting_approval' WHERE status = 'paused'").run();
  });

  migrate(db, 5, "metrics-indexes", () => {
    db.exec("CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_recovery_status ON recovery_events(status)");
  });
  migrate(db, 6, "workspace-persistence-v1", () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_roots (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        normalized_path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_workspace_roots_normalized_path
        ON workspace_roots(normalized_path);
    `);
  });

  migrate(db, 7, "durable-task-contract-v1", () => {
    ensureColumn(db, "tasks", "last_heartbeat", "TEXT");
    ensureColumn(db, "tasks", "execution_context", "TEXT");
    ensureColumn(db, "tasks", "max_recovery", "INTEGER");
    ensureColumn(db, "tasks", "retry_policy", "TEXT");
    ensureColumn(db, "tasks", "total_run_count", "INTEGER DEFAULT 0");
    ensureColumn(db, "tasks", "idempotency_key", "TEXT");

    ensureColumn(db, "task_steps", "error_type", "TEXT");
    ensureColumn(db, "task_steps", "run_when", "TEXT DEFAULT 'success'");
    ensureColumn(db, "task_steps", "step_timeout_ms", "INTEGER");
    ensureColumn(db, "task_steps", "attempts", "INTEGER DEFAULT 0");
    ensureColumn(db, "task_steps", "failed_attempts", "INTEGER DEFAULT 0");
    ensureColumn(db, "task_steps", "attempt_history", "TEXT");
    ensureColumn(db, "task_steps", "template_arguments", "TEXT");

    ensureColumn(db, "file_backups", "file_revision", "TEXT");
    ensureColumn(db, "projects", "status", "TEXT DEFAULT 'active'");

    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_idempotency_key
        ON tasks(idempotency_key) WHERE idempotency_key IS NOT NULL;
      CREATE TABLE IF NOT EXISTS task_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_task_id TEXT NOT NULL,
        target_task_id TEXT NOT NULL,
        relation TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (source_task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (target_task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_task_links_source ON task_links(source_task_id, id);
      CREATE INDEX IF NOT EXISTS idx_task_links_target ON task_links(target_task_id, id);
    `);
  });

  migrate(db, 8, "observability-schema-v1", () => {
    ensureColumn(db, "tool_calls", "category", "TEXT DEFAULT 'workflow'");
    ensureColumn(db, "recovery_events", "task_id", "TEXT");
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tool_calls_category_created_at
        ON tool_calls(category, created_at);
      CREATE INDEX IF NOT EXISTS idx_recovery_events_task_started
        ON recovery_events(task_id, started_at);
    `);
  });
  // R2 approval integrity: nullable additions preserve historical rows for a
  // controlled migration. Legacy unbound pending approvals fail closed at resume.
  migrate(db, 9, "r2-exact-task-approval-binding", () => {
    ensureColumn(db, "approval_requests", "tool_id", "TEXT");
    ensureColumn(db, "approval_requests", "request_fingerprint", "TEXT");
    ensureColumn(db, "approval_requests", "principal_id", "TEXT");
    ensureColumn(db, "approval_requests", "session_id", "TEXT");
    ensureColumn(db, "approval_requests", "expires_at", "TEXT");
    ensureColumn(db, "approval_requests", "dispatched_at", "TEXT");
  });
  // R3.01: persist the pre-existing TaskPlan.revision field; historical
  // rows start at revision 0 without rewriting user-owned data.
  migrate(db, 10, "r3-canonical-task-aggregate-revision", () => {
    ensureColumn(db, "tasks", "task_revision", "INTEGER NOT NULL DEFAULT 0");
  });

  // R3.02: append-only identity/intent for each attempted mutation. Finalizing
  // an existing receipt updates only its observed outcome, never its identity.
  // The table intentionally contains NO tool arguments, results or credentials.
  migrate(db, 11, "r3-durable-mutation-execution-receipts", () => {
    db.exec(`
      CREATE TABLE execution_receipts (
        execution_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        step_id INTEGER NOT NULL,
        attempt INTEGER NOT NULL CHECK(attempt > 0),
        tool_id TEXT NOT NULL,
        effect TEXT NOT NULL CHECK(effect IN ('idempotent_mutation','non_idempotent_mutation')),
        status TEXT NOT NULL CHECK(status IN ('started','succeeded','failed_known','outcome_unknown')),
        started_at TEXT NOT NULL,
        finished_at TEXT,
        reconciliation TEXT NOT NULL,
        termination TEXT,
        receipt_json TEXT NOT NULL,
        UNIQUE(task_id,step_id,attempt),
        CHECK ((status = 'started' AND finished_at IS NULL) OR
               (status != 'started' AND finished_at IS NOT NULL))
      );
      CREATE INDEX idx_execution_receipts_task_step ON execution_receipts(task_id,step_id,started_at);
    `);
  });
  // R3.07: monotonic fencing version must survive release/reacquire.
  migrate(db,12,"r3-durable-task-execution-lease",()=>{
    db.exec(`
      CREATE TABLE task_leases (
        task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
        owner_id TEXT NOT NULL,
        lease_token TEXT NOT NULL,
        version INTEGER NOT NULL CHECK(version>0),
        acquired_at TEXT NOT NULL,
        heartbeat_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        released_at TEXT
      );
      CREATE INDEX idx_task_leases_expiry ON task_leases(expires_at);
    `);
  });
  // R3.08: the key cannot be reused for a different canonical request or scope.
  // Legacy keyed rows have no verified hash; reject their ambiguous replay.
  migrate(db,13,"r3-task-creation-request-hash",()=>{
    ensureColumn(db,"tasks","request_hash","TEXT");
  });
  // R4.01: preserve historical file content and convert the overloaded
  // restored_at absent sentinel to an independent immutable previous_state.
  // No legacy post-mutation revision is manufactured.
  migrate(db,14,"r4-immutable-file-backup-snapshot",()=>{
    ensureColumn(db,"file_backups","target_canonical_path","TEXT");
    ensureColumn(db,"file_backups","previous_state","TEXT");
    ensureColumn(db,"file_backups","previous_revision","TEXT");
    ensureColumn(db,"file_backups","content_hash","TEXT");
    ensureColumn(db,"file_backups","content_ref","TEXT");
    ensureColumn(db,"file_backups","post_mutation_state","TEXT");
    ensureColumn(db,"file_backups","post_mutation_revision","TEXT");
    ensureColumn(db,"file_backups","legacy_unversioned","INTEGER NOT NULL DEFAULT 1");
    const rows=db.prepare("SELECT id,path,content,restored_at FROM file_backups")
      .all() as Array<{id:string;path:string;content:Buffer|string;restored_at:string|null}>;
    const classify=db.prepare("UPDATE file_backups SET target_canonical_path=?,previous_state=?,previous_revision=?,content_hash=?,content_ref=?,post_mutation_state=NULL,post_mutation_revision=NULL,legacy_unversioned=1,restored_at=? WHERE id=?");
    for(const row of rows){
      const absent=row.restored_at==="absent";
      const bytes=Buffer.isBuffer(row.content)?row.content:Buffer.from(row.content);
      const digest=absent?null:createHash("sha256").update(bytes).digest("hex");
      const target=path.isAbsolute(row.path)?path.normalize(row.path):null;
      classify.run(target,absent?"absent":"present",digest,digest,
        absent?null:"sqlite:file_backups:"+row.id,
        absent?null:row.restored_at,row.id);
    }
    db.exec("CREATE TRIGGER r4_backup_immutable BEFORE UPDATE ON file_backups WHEN NOT ("+
      "OLD.path IS NEW.path AND OLD.target_canonical_path IS NEW.target_canonical_path "+
      "AND OLD.previous_state IS NEW.previous_state AND OLD.previous_revision IS NEW.previous_revision "+
      "AND OLD.content_hash IS NEW.content_hash AND OLD.content_ref IS NEW.content_ref "+
      "AND OLD.content IS NEW.content AND OLD.file_revision IS NEW.file_revision "+
      "AND OLD.correlation_id IS NEW.correlation_id AND OLD.created_at IS NEW.created_at "+
      "AND OLD.legacy_unversioned IS NEW.legacy_unversioned "+
      "AND (OLD.post_mutation_state IS NEW.post_mutation_state OR "+
      "(OLD.post_mutation_state IS NULL AND NEW.post_mutation_state IN ('present','absent'))) "+
      "AND (OLD.post_mutation_revision IS NEW.post_mutation_revision OR "+
      "(OLD.post_mutation_revision IS NULL AND NEW.post_mutation_revision IS NOT NULL "+
      "AND OLD.post_mutation_state IS NULL))"+
      ") BEGIN SELECT RAISE(ABORT,'immutable_file_backup_snapshot'); END");
  });

  // R4.04: preserve project ownership without guessing which colliding ID
  // owns memory or Task history. The entire migration rolls back on collision.
  migrate(db,15,"r4-canonical-project-identity",()=>{
    ensureColumn(db,"projects","canonical_path","TEXT");
    ensureColumn(db,"projects","display_path","TEXT");
    const projects=db.prepare("SELECT id,path FROM projects ORDER BY id")
      .all() as Array<{id:string;path:string}>;
    const identities=new Map<string,string>();
    const normalized:Array<{id:string;canonical:string;display:string}>=[];
    for(const project of projects){
      if(!path.isAbsolute(project.path))
        throw new Error(`PROJECT_PATH_UNVERIFIED: ${project.id}`);
      const canonical=canonicalProjectPath(project.path);
      const owner=identities.get(canonical);
      if(owner && owner!==project.id)
        throw new Error(`PROJECT_CANONICAL_COLLISION: ${owner} / ${project.id} -> ${canonical}. Resolve ownership explicitly before migrating.`);
      identities.set(canonical,project.id);
      normalized.push({id:project.id,canonical,display:project.path});
    }
    const update=db.prepare("UPDATE projects SET canonical_path=?,display_path=? WHERE id=?");
    for(const item of normalized) update.run(item.canonical,item.display,item.id);
    db.exec(`
      CREATE UNIQUE INDEX idx_projects_canonical_identity ON projects(canonical_path);
      CREATE TRIGGER projects_canonical_required_insert BEFORE INSERT ON projects
      WHEN NEW.canonical_path IS NULL OR NEW.canonical_path=''
      BEGIN SELECT RAISE(ABORT,'project_canonical_identity_required'); END;
      CREATE TRIGGER projects_canonical_required_update BEFORE UPDATE ON projects
      WHEN NEW.canonical_path IS NULL OR NEW.canonical_path=''
      BEGIN SELECT RAISE(ABORT,'project_canonical_identity_required'); END;
    `);
  });


  // R5.02: persistent hashed client credentials; raw secrets never enter SQLite.
  migrate(db,16,"r5-oauth-credential-repository",()=>{
    db.exec(`
      CREATE TABLE oauth_access_tokens (
        token_hash TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL,
        client_id TEXT NOT NULL,
        resource TEXT NOT NULL,
        scopes_json TEXT NOT NULL,
        family_id TEXT NOT NULL,
        issued_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER
      );
      CREATE INDEX idx_oauth_access_expires ON oauth_access_tokens(expires_at);
      CREATE INDEX idx_oauth_access_family ON oauth_access_tokens(family_id);
      CREATE TABLE oauth_refresh_tokens (
        token_hash TEXT PRIMARY KEY,
        family_id TEXT NOT NULL,
        generation INTEGER NOT NULL,
        principal_id TEXT NOT NULL,
        client_id TEXT NOT NULL,
        resource TEXT NOT NULL,
        scopes_json TEXT NOT NULL,
        issued_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER,
        revoked_at INTEGER,
        rotated_to_hash TEXT,
        UNIQUE(family_id,generation)
      );
      CREATE INDEX idx_oauth_refresh_expires ON oauth_refresh_tokens(expires_at);
      CREATE INDEX idx_oauth_refresh_family ON oauth_refresh_tokens(family_id,generation);
      CREATE TABLE oauth_revoked_families (
        family_id TEXT PRIMARY KEY,
        revoked_at INTEGER NOT NULL
      );
      CREATE TABLE oauth_registered_clients (
        client_id TEXT PRIMARY KEY,
        redirect_uris_json TEXT NOT NULL,
        registered_at INTEGER NOT NULL
      );
    `);
  });

  // R6.04: measured at 250k representative tool calls: task/category-scoped
  // Metrics queries use the leading task_id/category keys and time ordering.
  // Existing historical data is indexed transactionally by migrate().
  migrate(db,17,"r6-metrics-task-category-created-index",()=>{
    db.exec("CREATE INDEX idx_tool_calls_task_category_created_at ON tool_calls(task_id,category,created_at DESC)");
  });

  // H6/AUDIT-M2: projects and memory_items are per-principal data. Without an
  // owner column every authenticated client could read, overwrite or delete
  // another client's project context and memory. Existing rows are attributed
  // to the local-stdio operator so single-operator installs keep working.
  migrate(db,18,"principal-owned-projects-and-memory",()=>{
    ensureColumn(db,"projects","principal_id","TEXT NOT NULL DEFAULT 'local-stdio'");
    ensureColumn(db,"memory_items","principal_id","TEXT NOT NULL DEFAULT 'local-stdio'");
    db.exec("CREATE INDEX IF NOT EXISTS idx_projects_principal ON projects(principal_id,updated_at DESC)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_memory_items_principal ON memory_items(principal_id,id DESC)");
  });

  // M-metrics per-principal. agent_metrics previously aggregated every
  // client's tool calls and step executions, so one authenticated client could
  // see another's traffic volumes and failure rates. tasks is the root table
  // for executions and tool_calls, so the principal is stored once there;
  // existing rows belong to the local-stdio operator.
  migrate(db,19,"principal-owned-tasks",()=>{
    ensureColumn(db,"tasks","principal_id","TEXT NOT NULL DEFAULT 'local-stdio'");
    db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_principal ON tasks(principal_id,updated_at DESC)");
  });

  // R3: fold the legacy transitional Task states onto the canonical aggregate.
  // `TaskState` no longer admits these values; rows still carrying them would
  // hydrate into plans the state machine refuses to transition. Rewrite them
  // at upgrade time so no row is left unreachable. Idempotent by construction:
  // after the first run no row matches the legacy predicates.
  migrate(db,20,"consolidate-canonical-task-states",()=>{
    db.prepare("UPDATE tasks SET status='planning' WHERE status='created'").run();
    db.prepare("UPDATE tasks SET status='executing' WHERE status='checkpointing'").run();
    db.prepare("UPDATE tasks SET status='executing' WHERE status='resuming'").run();
  });

  // A Task is now owned directly by a Project. Until now the only link was an
  // optional memory_items row carrying both ids — listing a project's tasks
  // required a memory scan and could not be enforced by the schema. The column
  // stays nullable so existing tasks remain valid; new tasks carry it from
  // task_create. memory_items gains updated_at so memory_update can record when
  // a record last changed (append-only rows have no such column today).
  migrate(db,21,"task-project-binding-and-memory-timestamps",()=>{
    ensureColumn(db,"tasks","project_id","TEXT");
    ensureColumn(db,"memory_items","updated_at","TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id,updated_at DESC)");
  });

  // The file-idempotency response cache was added to the base schema for
  // NEWLY created databases only (base-schema.migration.ts). Databases created
  // before that addition — including every live deployment that predates it —
  // never received the table, so write_file/delete_file with an idempotencyKey
  // failed on upgraded databases ("no such table: idempotency_responses" ->
  // tool_handler_failure) while fresh databases passed every test. Backfill it
  // here so existing installs gain file idempotency. Idempotent by construction:
  // CREATE TABLE IF NOT EXISTS is a no-op where the table already exists.
  migrate(db,22,"file-idempotency-response-cache-table",()=>{
    db.exec(`
      CREATE TABLE IF NOT EXISTS idempotency_responses (
        id TEXT NOT NULL,
        operation TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        response TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (id, operation, request_hash)
      );
    `);
  });

  // CI-2.01 — Chat Isolation control plane. Created here (NOT in base-schema)
  // deliberately: runMigrations executes on fresh and existing databases alike,
  // so a single idempotent definition serves both and there is no fresh-only
  // gap of the kind migration 22 repaired for idempotency_responses.
  //
  // These tables are additive: nothing in the shipped code path reads them yet
  // (CTX_ISOLATION_MODE=OFF), so applying the migration to an existing
  // deployment cannot change behavior. CI-2.02/Ci-2.05 wire the resolvers that
  // use them, still behind the flag.
  migrate(db,23,"ci-control-schema",()=>{
    db.exec(`
      CREATE TABLE IF NOT EXISTS context_registry (
        context_id TEXT NOT NULL PRIMARY KEY,
        owner_id TEXT NOT NULL,
        project_label TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'ACTIVE'
          CHECK (state IN ('ACTIVE','FROZEN','TRANSFERRING','ARCHIVED')),
        workspace_grant_id TEXT NOT NULL,
        storage_locator TEXT NOT NULL UNIQUE,
        context_epoch INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_context_owner_state
        ON context_registry(owner_id, state);

      CREATE TABLE IF NOT EXISTS context_binding (
        binding_id TEXT NOT NULL PRIMARY KEY,
        owner_id TEXT NOT NULL,
        context_id TEXT NOT NULL REFERENCES context_registry(context_id),
        connection_id TEXT NOT NULL,
        credential_hash TEXT NOT NULL,
        credential_version INTEGER NOT NULL DEFAULT 1,
        scopes_json TEXT NOT NULL DEFAULT '[]',
        state TEXT NOT NULL DEFAULT 'ACTIVE'
          CHECK (state IN ('ACTIVE','REVOKED','EXPIRED')),
        created_at TEXT NOT NULL,
        UNIQUE (connection_id, credential_version),
        UNIQUE (credential_hash, credential_version)
      );
      CREATE INDEX IF NOT EXISTS idx_binding_context
        ON context_binding(context_id, state);

      CREATE TABLE IF NOT EXISTS workspace_grant (
        grant_id TEXT NOT NULL PRIMARY KEY,
        context_id TEXT NOT NULL REFERENCES context_registry(context_id),
        canonical_root TEXT NOT NULL,
        worktree_locator TEXT,
        access_mode TEXT NOT NULL DEFAULT 'READ_WRITE'
          CHECK (access_mode IN ('READ_ONLY','READ_WRITE')),
        lease_id TEXT,
        grant_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_grant_context
        ON workspace_grant(context_id, grant_version);

      CREATE TABLE IF NOT EXISTS ownership_lease (
        context_id TEXT NOT NULL PRIMARY KEY
          REFERENCES context_registry(context_id),
        owner_binding_id TEXT NOT NULL REFERENCES context_binding(binding_id),
        context_epoch INTEGER NOT NULL,
        lease_deadline_ms INTEGER NOT NULL,
        fencing_token TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS handoff_intent (
        intent_id TEXT NOT NULL PRIMARY KEY,
        source_context_id TEXT NOT NULL REFERENCES context_registry(context_id),
        source_binding_id TEXT NOT NULL REFERENCES context_binding(binding_id),
        target_connection_id TEXT NOT NULL,
        target_context_id TEXT REFERENCES context_registry(context_id),
        kind TEXT NOT NULL CHECK (kind IN ('TRANSFER','FORK')),
        state TEXT NOT NULL DEFAULT 'PREPARED'
          CHECK (state IN ('PREPARED','APPROVED','DRAINING','COMMITTED',
                           'CANCELLED','EXPIRED','FAILED')),
        source_epoch INTEGER NOT NULL,
        ticket_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        approved_by_owner_id TEXT,
        approved_at TEXT,
        committed_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_intent_source_state
        ON handoff_intent(source_context_id, state);

      CREATE TABLE IF NOT EXISTS security_audit (
        id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        owner_id TEXT,
        context_id TEXT,
        binding_id TEXT,
        action TEXT NOT NULL,
        decision TEXT NOT NULL CHECK (decision IN ('ALLOW','DENY')),
        trace_id TEXT,
        occurred_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_context_time
        ON security_audit(context_id, occurred_at);
    `);
  });

  // CI-2.02 — a binding carries the server-issued principal for its connection
  // (distinct per connection; this is what removes the shared "operator"
  // identity). Added after 23 because the reuse path needs it on record: a
  // connection re-authorizing must get its ORIGINAL principal back, not a new
  // one. The table is empty on every deployment (23 creates it and nothing
  // writes to it while the flag is OFF), so the NOT NULL default '' cannot
  // collide with real data.
  migrate(db,24,"ci-binding-principal-id",()=>{
    ensureColumn(db,"context_binding","principal_id","TEXT NOT NULL DEFAULT ''");
  });

}