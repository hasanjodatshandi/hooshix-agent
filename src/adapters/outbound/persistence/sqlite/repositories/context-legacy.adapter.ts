import type Database from "better-sqlite3";

/**
 * CI-2.03 — Legacy Context pinning.
 *
 * Every deployment that predates CI issued all grants with principal_id
 * "operator" (CI-0.03 evidence: `SELECT DISTINCT principal_id FROM
 * oauth_access_tokens` returns exactly one row). When the flag flips, those
 * grants must keep working — ADR-CI-007 forbids invalidating live credentials
 * — but they cannot be left unbound either, or every legacy request becomes
 * CONTEXT_NOT_BOUND.
 *
 * The resolution is a single, well-known LEGACY Context that owns the shared
 * pre-CI state, with one binding per legacy token hash. This is deliberately
 * honest: legacy grants really do share one identity, so they share one
 * Context. It is a compatibility bridge, never a fallback — a NEW connection
 * that is unbound still gets CONTEXT_NOT_BOUND (I-06), never the legacy
 * Context.
 */

/** Stable, recognizable id so the legacy Context is never confused with a real one. */
export const LEGACY_CONTEXT_ID = "ctx-legacy-shared-operator";
const LEGACY_BINDING_PREFIX = "bind-legacy-";
const LEGACY_CONNECTION_ID = "conn-legacy-operator";
const LEGACY_GRANT_ID = "grant-legacy-shared";
const LEGACY_PRINCIPAL_ID = "operator";

export interface LegacyPinResult {
  readonly contextId: string;
  readonly pinnedTokenCount: number;
  readonly canonicalRoot: string | null;
  readonly alreadyExisted: boolean;
}

/**
 * Idempotent: creates the LEGACY Context (once) and a binding for every active
 * legacy token that does not already have one. Safe to call on every CI
 * initialization; a no-op after the first run except for tokens minted since.
 */
export function pinLegacyContext(db: Database.Database, now: string): LegacyPinResult {
  const existing = db
    .prepare("SELECT 1 FROM context_registry WHERE context_id = ?")
    .get(LEGACY_CONTEXT_ID);
  const alreadyExisted = Boolean(existing);

  const canonicalRoot = pickLegacyCanonicalRoot(db);

  if (!alreadyExisted) {
    db.prepare(
      "INSERT INTO context_registry(context_id, owner_id, project_label, state, workspace_grant_id, storage_locator, created_at, updated_at)" +
        " VALUES(?,?,?,?,?,?,?,?)",
    ).run(
      LEGACY_CONTEXT_ID,
      LEGACY_PRINCIPAL_ID,
      "legacy-shared-operator",
      "ACTIVE",
      LEGACY_GRANT_ID,
      "data/legacy",
      now,
      now,
    );
    db.prepare(
      "INSERT INTO workspace_grant(grant_id, context_id, canonical_root, access_mode, created_at)" +
        " VALUES(?,?,?,?,?)",
    ).run(LEGACY_GRANT_ID, LEGACY_CONTEXT_ID, canonicalRoot ?? "<unrestricted-pool>", "READ_WRITE", now);
  } else if (canonicalRoot) {
    // A later run may know the workspace better than the first; keep the grant
    // pointing at the current canonical root.
    db.prepare(
      "UPDATE workspace_grant SET canonical_root=? WHERE grant_id=? AND canonical_root='<unrestricted-pool>'",
    ).run(canonicalRoot, LEGACY_GRANT_ID);
  }

  // Bind every active legacy token that has no binding yet. Legacy tokens were
  // issued with no connection concept (every grant was "operator"), so each is
  // treated as its own synthetic connection — they are genuinely independent
  // credentials — while all of them resolve to the SAME legacy Context. That
  // is the honest mapping: they really did share one identity.
  const legacyTokens = db
    .prepare(
      "SELECT token_hash, scopes_json FROM oauth_access_tokens" +
        " WHERE principal_id=? AND revoked_at IS NULL" +
        " AND NOT EXISTS (SELECT 1 FROM context_binding WHERE credential_hash=oauth_access_tokens.token_hash)",
    )
    .all(LEGACY_PRINCIPAL_ID) as Array<{ token_hash: string; scopes_json: string }>;

  const insertBinding = db.prepare(
    "INSERT OR IGNORE INTO context_binding(binding_id, owner_id, context_id, connection_id, principal_id, credential_hash, scopes_json, created_at)" +
      " VALUES(?,?,?,?,?,?,?,?)",
  );
  let pinned = 0;
  for (const token of legacyTokens) {
    const suffix = token.token_hash.slice(0, 48);
    const result = insertBinding.run(
      LEGACY_BINDING_PREFIX + suffix,
      LEGACY_PRINCIPAL_ID,
      LEGACY_CONTEXT_ID,
      LEGACY_CONNECTION_ID + "-" + suffix,
      LEGACY_PRINCIPAL_ID,
      token.token_hash,
      token.scopes_json,
      now,
    );
    pinned += result.changes;
  }

  return {
    contextId: LEGACY_CONTEXT_ID,
    pinnedTokenCount: pinned,
    canonicalRoot,
    alreadyExisted,
  };
}

/**
 * The deployment's own workspace root, if any is configured. Legacy state had a
 * pool of roots with no explicit primary, so prefer the one this process
 * actually runs from — that is the deployment's real workspace — and fall back
 * to the first configured root.
 */
function pickLegacyCanonicalRoot(db: Database.Database): string | null {
  const rows = db
    .prepare("SELECT normalized_path FROM workspace_roots")
    .all() as Array<{ normalized_path: string }>;
  if (rows.length === 0) return null;
  const cwd = process.cwd().toLowerCase();
  const containing = rows
    .map((r) => r.normalized_path)
    .filter((p) => p && cwd.startsWith(p.toLowerCase()))
    .sort((a, b) => b.length - a.length);
  if (containing.length > 0) return containing[0];
  return rows[0].normalized_path;
}

/** Is a given principal id the legacy shared identity? */
export function isLegacyPrincipal(principalId: string): boolean {
  return principalId === LEGACY_PRINCIPAL_ID;
}

/** Is a given context the legacy compatibility Context? */
export function isLegacyContextId(contextId: string): boolean {
  return contextId === LEGACY_CONTEXT_ID;
}
