import fs from "node:fs";
import path from "node:path";
import { withAgentDatabase } from "../../../../../core/memory/database.js";

export interface PersistedWorkspaceRoot {
  path: string;
  normalizedPath: string;
  createdAt: string;
}

export function canonicalizeWorkspacePath(input: string): string {
  const resolved = path.resolve(input);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

export function workspaceIdentity(input: string): string {
  const canonical = canonicalizeWorkspacePath(input);
  return process.platform === "win32" ? canonical.toLowerCase() : canonical;
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

export function resetWorkspacePolicyRepositoryForTests(): void {
  withAgentDatabase((db) => db.prepare("DELETE FROM workspace_roots").run());
}