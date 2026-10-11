import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseProjectHandleTtlMs } from "../infrastructure/config/app-config.js";
import { listWorkspaceRoots, sameRootIdentity } from "./workspace-guard.js";

/**
 * CI-G6 — conversation-scoped project handles.
 *
 * A single OAuth connection is shared by every ChatGPT conversation, and the
 * 2026 MCP revision is served per request with no session id, so the server has
 * no way to tell two chats apart. The only per-conversation carrier is the
 * conversation itself: `open_project` mints an opaque handle that lives only in
 * that chat's model context, and every workspace-bound call must echo it as
 * `project=<handle>`. Two chats therefore cannot bleed an "active project" into
 * each other — there is no shared mutable selection at all.
 *
 * Handles are bound to the authenticated principal, expire absolutely, are
 * capped per principal, and can be revoked (close_project). The store is
 * in-memory on purpose: a restart revokes every handle, which is the
 * fail-closed default for a capability minted to a conversation.
 */

const HANDLE_PREFIX = "ph_";
const DEFAULT_CAP = 64;

export interface ProjectHandleRecord {
  readonly handle: string;
  readonly principalId: string;
  /** Human-readable folder name of the root (what `set_workspace` calls the project). */
  readonly label: string;
  /** Canonical (realpath-resolved) root — always a member of the persisted pool. */
  readonly root: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface ProjectSelectorResolution {
  readonly root: string;
  readonly label: string;
}

export type ProjectHandleLookup =
  | { readonly ok: true; readonly record: ProjectHandleRecord }
  | { readonly ok: false; readonly error: "unknown" | "expired" };

class ProjectHandleStore {
  private readonly entries = new Map<string, ProjectHandleRecord>();
  constructor(
    private readonly now: () => number = Date.now,
    private readonly cap = DEFAULT_CAP,
  ) {}

  private prune(): void {
    const current = this.now();
    for (const [id, item] of this.entries) {
      if (current >= item.expiresAt) this.entries.delete(id);
    }
  }

  mint(principalId: string, root: string, label: string): ProjectHandleRecord {
    this.prune();
    // Opening the same project again is idempotent: the live handle is reused
    // (and its expiry refreshed) so a conversation that re-opens its project
    // keeps working with the handle it already has.
    for (const [id, item] of this.entries) {
      if (item.principalId === principalId && sameRootIdentity(item.root, root)) {
        const refreshed: ProjectHandleRecord = Object.freeze({
          ...item, label, expiresAt: this.now() + parseProjectHandleTtlMs(),
        });
        this.entries.set(id, refreshed);
        return refreshed;
      }
    }
    let owned = 0;
    for (const item of this.entries.values()) {
      if (item.principalId === principalId) owned++;
    }
    if (owned >= this.cap)
      throw new Error("project_handle_limit: too many open project handles for this credential — close unused ones with close_project");
    let handle: string;
    do {
      handle = HANDLE_PREFIX + crypto.randomBytes(12).toString("base64url");
    } while (this.entries.has(handle));
    const createdAt = this.now();
    const record: ProjectHandleRecord = Object.freeze({
      handle, principalId, label, root,
      createdAt, expiresAt: createdAt + parseProjectHandleTtlMs(),
    });
    this.entries.set(handle, record);
    return record;
  }

  resolve(handle: string, principalId: string): ProjectHandleLookup {
    const item = this.entries.get(handle);
    if (!item) return { ok: false, error: "unknown" };
    if (this.now() >= item.expiresAt) {
      this.entries.delete(handle);
      return { ok: false, error: "expired" };
    }
    // A handle never crosses credentials: another connection's handle is
    // indistinguishable from a forged one (no existence disclosure).
    if (item.principalId !== principalId) return { ok: false, error: "unknown" };
    return { ok: true, record: item };
  }

  close(handle: string, principalId: string): ProjectHandleRecord | null {
    const item = this.entries.get(handle);
    if (!item || item.principalId !== principalId) return null;
    this.entries.delete(handle);
    return item;
  }
}

const store = new ProjectHandleStore();

export function mintProjectHandle(principalId: string, root: string, label: string): ProjectHandleRecord {
  return store.mint(principalId, root, label);
}
export function resolveProjectHandle(handle: string, principalId: string): ProjectHandleLookup {
  return store.resolve(handle, principalId);
}
export function closeProjectHandle(handle: string, principalId: string): ProjectHandleRecord | null {
  return store.close(handle, principalId);
}

/**
 * Resolve an `open_project` selector to a pool root. Two forms are accepted:
 * an exact path (must canonicalize to a persisted root) or a bare folder name
 * when it is unique among the roots. Anything outside the persisted pool is
 * refused — opening a project can never add authority, exactly like
 * set_workspace. Errors carry actionable guidance for the model.
 */
export function resolveProjectSelector(selector: string): ProjectSelectorResolution {
  const pool = listWorkspaceRoots().map((root) => root.path);
  const describePool = () =>
    pool.length
      ? pool.map((p) => `${path.basename(p)} (${p})`).join(", ")
      : "(none — add one with add_workspace_roots)";
  let match: string | undefined;
  const direct = path.resolve(selector);
  try {
    if (fs.existsSync(direct)) {
      const real = fs.realpathSync(direct);
      match = pool.find((root) => sameRootIdentity(root, real));
    }
  } catch {
    /* not a resolvable path — fall through to the name form */
  }
  // Name matching only for bare names: an absolute or separator-bearing
  // selector must match a pool path exactly, never a same-named different root.
  const looksPath = path.isAbsolute(selector) || selector.includes("/") || selector.includes("\\");
  if (!match && !looksPath) {
    const wanted = selector.toLowerCase();
    const byName = pool.filter((root) => path.basename(root).toLowerCase() === wanted);
    if (byName.length > 1)
      throw new Error(`project_ambiguous: multiple allowed roots are named "${selector}": ${byName.join(", ")} — pass the full path instead`);
    match = byName[0];
  }
  if (!match)
    throw new Error(`project_not_allowed: "${selector}" is not an allowed project. Allowed projects: ${describePool()}.`);
  if (!fs.existsSync(match))
    throw new Error(`project_unavailable: ${match} does not exist on disk — fix or remove it with remove_workspace_root`);
  return { root: fs.realpathSync(match), label: path.basename(match) };
}
