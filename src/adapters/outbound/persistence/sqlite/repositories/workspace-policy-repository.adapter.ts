import fs from "node:fs";
import path from "node:path";
import {isWSLWorkspaceURI} from "../../../../../security/wsl-workspace-uri.js";
import { withAgentDatabase } from "../../../../../core/memory/database/index.js";

export interface PersistedWorkspaceRoot {
  path: string;
  normalizedPath: string;
  createdAt: string;
}

export function canonicalizeWorkspacePath(input: string): string {
  if(isWSLWorkspaceURI(input))return input;
  const resolved = path.resolve(input);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

export function workspaceIdentity(input: string): string {
  const canonical = canonicalizeWorkspacePath(input);
  return isWSLWorkspaceURI(canonical) ? canonical : process.platform === "win32" ? canonical.toLowerCase() : canonical;
}

export function listPersistedWorkspaceRoots(): PersistedWorkspaceRoot[] {
  return withAgentDatabase((db) => db.prepare(
    "SELECT path, normalized_path AS normalizedPath, created_at AS createdAt FROM workspace_roots ORDER BY created_at, path"
  ).all() as PersistedWorkspaceRoot[]);
}

export function persistWorkspaceRoot(rootPath: string): PersistedWorkspaceRoot {
  const canonical = canonicalizeWorkspacePath(rootPath);
  const normalizedPath = workspaceIdentity(canonical);
  const createdAt = new Date().toISOString();
  withAgentDatabase((db) => db.prepare(`
    INSERT INTO workspace_roots(id, path, normalized_path, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(normalized_path) DO UPDATE SET path = excluded.path, updated_at = excluded.updated_at
  `).run(normalizedPath, canonical, normalizedPath, createdAt, createdAt));
  return { path: canonical, normalizedPath, createdAt };
}

export function removePersistedWorkspaceRoot(rootPath: string): boolean {
  const normalizedPath = workspaceIdentity(rootPath);
  return withAgentDatabase((db) => db.prepare(
    "DELETE FROM workspace_roots WHERE normalized_path = ?"
  ).run(normalizedPath).changes === 1);
}

export function isPersistedWorkspaceRootAllowed(rootPath: string): boolean {
  const normalizedPath = workspaceIdentity(rootPath);
  return withAgentDatabase((db) => Boolean(db.prepare(
    "SELECT 1 FROM workspace_roots WHERE normalized_path = ?"
  ).get(normalizedPath)));
}

/** Owner-attested WSL workspace bindings belong to the workspace persistence adapter. */
export interface PersistedWSLBinding {
  ownerWindowsRoot: string;
  distro: string;
  linuxRoot: string;
}

export function findPersistedWSLBinding(uri: string, principalId: string): PersistedWSLBinding | null {
  return withAgentDatabase(db => db.prepare(
    "SELECT windows_owner_anchor AS ownerWindowsRoot, distro, linux_root AS linuxRoot FROM wsl_workspace_bindings WHERE workspace_uri=? AND principal_id=?"
  ).get(uri, principalId) as PersistedWSLBinding | undefined) ?? null;
}

export function registerPersistedWSLBinding(binding: {
  uri: string; ownerWindowsRoot: string; distro: string; linuxRoot: string;
}, principalId: string): void {
  withAgentDatabase(db => db.transaction(() => {
    const existing = db.prepare(
      "SELECT windows_owner_anchor AS anchor, principal_id AS principalId FROM wsl_workspace_bindings WHERE workspace_uri=?"
    ).get(binding.uri) as {anchor:string;principalId:string} | undefined;
    if (existing && (existing.anchor.toLowerCase() !== binding.ownerWindowsRoot.toLowerCase() ||
                     existing.principalId !== principalId))
      throw new Error("wsl_workspace_binding_change_requires_revocation");
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO workspace_roots(id,path,normalized_path,created_at,updated_at)
      VALUES (?,?,?,?,?) ON CONFLICT(normalized_path) DO UPDATE SET updated_at=excluded.updated_at`)
      .run(binding.uri, binding.uri, binding.uri, now, now);
    db.prepare(`INSERT INTO wsl_workspace_bindings(workspace_uri,windows_owner_anchor,distro,linux_root,created_at,principal_id)
      VALUES (?,?,?,?,?,?) ON CONFLICT(workspace_uri) DO NOTHING`)
      .run(binding.uri, binding.ownerWindowsRoot, binding.distro, binding.linuxRoot, now, principalId);
  })());
}

export function unregisterPersistedWSLBinding(uri: string, principalId: string): void {
  withAgentDatabase(db => db.transaction(() => {
    const authorized = db.prepare(
      "SELECT 1 FROM wsl_workspace_bindings WHERE workspace_uri=? AND principal_id=?"
    ).get(uri, principalId);
    if (!authorized) throw new Error("wsl_workspace_binding_not_owned_by_principal");
    db.prepare("DELETE FROM wsl_workspace_bindings WHERE workspace_uri=? AND principal_id=?").run(uri, principalId);
    db.prepare("DELETE FROM workspace_roots WHERE normalized_path=?").run(uri);
  })());
}

export function resetWorkspacePolicyRepositoryForTests(): void {
  withAgentDatabase((db) => db.prepare("DELETE FROM workspace_roots").run());
}