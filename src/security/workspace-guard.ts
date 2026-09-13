import fs from "node:fs";
import path from "node:path";
import { policyDecisionPoint } from "../core/governance/policy-decision-point.js";

// Supported workspace roots (comma-separated in env var).
// EMPTY BY DEFAULT: no implicit root, no implicit active workspace — access
// exists only after explicit configuration (HOOSHIX_WORKSPACE or
// add_workspace_roots). `initialized` pins the lazy env parse so test resets
// via replaceWorkspaceRoots aren't re-seeded from the environment.
let workspaceRoots: string[] = [];
let activeWorkspace: string | null = null;
let initialized = false;

/**
 * Canonical identity for a workspace-root/path comparison. On Windows (and
 * any case-insensitive filesystem), `D:\test` and `d:\TEST` are the SAME
 * directory — comparing raw strings would let the same logical root register
 * twice (defect WM-01) and drift the allowed pool. Case-folding is only
 * applied on win32; POSIX filesystems are case-sensitive and keep exact
 * casing, where differing case means two genuinely different directories.
 */
function canonicalRootIdentity(p: string): string {
  const real = (() => {
    try {
      return fs.realpathSync(path.resolve(p));
    } catch {
      return path.resolve(p);
    }
  })();
  return process.platform === "win32" ? real.toLowerCase() : real;
}

/** Equality of two paths as workspace identities (case-insensitive on win32). */
function sameRootIdentity(a: string, b: string): boolean {
  return canonicalRootIdentity(a) === canonicalRootIdentity(b);
}

function initWorkspaceRoots(): string[] {
  if (initialized) return workspaceRoots;
  initialized = true;
  // Empty by default: the allowed pool starts EMPTY and no workspace is
  // active until roots are explicitly configured. HOOSHIX_WORKSPACE is the
  // operator seeding path (comma-separated); process.cwd() is deliberately
  // NOT a fallback — an MCP server must never start with implicit filesystem
  // access to wherever it happened to be launched from.
  const envValue = process.env.HOOSHIX_WORKSPACE?.trim();
  workspaceRoots = (envValue ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      try {
        return fs.realpathSync(path.resolve(p));
      } catch {
        return path.resolve(p);
      }
    });
  if (workspaceRoots.length > 0) activeWorkspace = workspaceRoots[0];
  // Auto-enable unrestricted mode from env
  if (process.env.HOOSHIX_UNRESTRICTED === "1" || process.env.HOOSHIX_UNRESTRICTED === "true") {
    unrestrictedMode = true;
  }
  return workspaceRoots;
}

/**
 * Get the active workspace root. With the empty-by-default pool model, there
 * is NO implicit default — until the operator seeds HOOSHIX_WORKSPACE or a
 * root is added via add_workspace_roots, no workspace is active and file
 * tools have nothing to operate on (fail-closed: callers must handle null).
 */
export function getWorkspaceRoot(): string | null {
  initWorkspaceRoots();
  return activeWorkspace;
}

/** Alias with a self-documenting name for scope checks (null = no active workspace). */
export function getActiveWorkspace(): string | null {
  return getWorkspaceRoot();
}

/**
 * Set the active workspace root. With the multi-root pool model, the target
 * must ALREADY be an allowed root (added via add_workspace_roots or
 * HOOSHIX_WORKSPACE) — set_workspace only SELECTS among the allowed pool and
 * never mutates it (no permission accumulation through switching).
 * Returns { resolved, previous }.
 */
export function setActiveWorkspace(rootPath: string): { resolved: string; previous: string | null } {
  initWorkspaceRoots();
  const resolved = path.resolve(rootPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Workspace path does not exist: ${resolved}`);
  }
  const real = fs.realpathSync(resolved);
  if (!workspaceRoots.some((r) => sameRootIdentity(r, real))) {
    throw new Error(
      `Access denied: ${real} is not an allowed workspace root. ` +
      `Add it first with add_workspace_roots. Allowed: ${workspaceRoots.length > 0 ? workspaceRoots.join(", ") : "(none — the pool is empty)"}`
    );
  }
  const previous = activeWorkspace;
  activeWorkspace = real;
  // NOTE: unrestricted mode is NOT enabled implicitly — enabling it is a
  // separate, explicit decision (HOOSHIX_UNRESTRICTED at boot; no runtime
  // elevation path exists anymore).
  return { resolved: real, previous };
}

/** List all configured workspace roots with existence metadata */
export function listWorkspaceRoots(): Array<{ path: string; exists: boolean; active: boolean }> {
  initWorkspaceRoots();
  const active = getWorkspaceRoot();
  return workspaceRoots.map((root) => ({
    path: root,
    exists: fs.existsSync(root),
    active: root === active,
  }));
}

/**
 * Remove a workspace root from the allowed pool. The ACTIVE workspace cannot
 * be removed — it is the scope file tools actually operate in; switch to
 * another allowed root first.
 */
export function removeWorkspaceRoot(rootPath: string): boolean {
  initWorkspaceRoots();
  if (activeWorkspace !== null && sameRootIdentity(rootPath, activeWorkspace)) {
    throw new Error("Cannot remove the active workspace — use set_workspace to select another allowed root first.");
  }
  const index = workspaceRoots.findIndex((r) => sameRootIdentity(r, rootPath));
  if (index === -1) return false;
  workspaceRoots.splice(index, 1);
  return true;
}

/**
 * Add one or more roots to the allowed pool (idempotent — already-allowed
 * roots resolve to added:false). Roots must exist. The FIRST root ever added
 * also becomes the active workspace (there must always be exactly one active
 * workspace for file tools to operate in).
 */
export function addWorkspaceRoots(paths: string[]): Array<{ path: string; added: boolean }> {
  initWorkspaceRoots();
  const results: Array<{ path: string; added: boolean }> = [];
  for (const p of paths) {
    const resolved = path.resolve(p);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Workspace path does not exist: ${resolved}`);
    }
    const real = fs.realpathSync(resolved);
    if (workspaceRoots.some((r) => sameRootIdentity(r, real))) {
      results.push({ path: real, added: false });
      continue;
    }
    workspaceRoots.push(real);
    results.push({ path: real, added: true });
  }
  if (activeWorkspace === null && workspaceRoots.length > 0) {
    activeWorkspace = workspaceRoots[0];
  }
  return results;
}
/**
 * Test/bootstrap helper: reset the root pool to a single root and make it
 * active. NOT registered as an MCP tool — the pool is only mutated through
 * add/remove at runtime; tests use this to set up isolation.
 */
export function replaceWorkspaceRoots(rootPath: string): string[] {
  const resolved = path.resolve(rootPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Workspace path does not exist: ${resolved}`);
  }
  const real = fs.realpathSync(resolved);
  workspaceRoots = [real];
  activeWorkspace = real;
  // The reset OWNS the pool from here: mark the module initialized so a
  // later lazy initWorkspaceRoots() cannot re-seed from HOOSHIX_WORKSPACE
  // and clobber this setup (test isolation depends on it).
  initialized = true;
  return [...workspaceRoots];
}

let unrestrictedMode = false;

/**
 * Test-only: reset the pool to the EMPTY unconfigured state (no roots, no
 * active workspace, env parse already consumed). Pinning the empty-by-default
 * contract in tests; NEVER exposed through any tool or runtime path.
 */
export function __clearWorkspaceStateForTests(): void {
  workspaceRoots = [];
  activeWorkspace = null;
  initialized = true;
}

/**
 * Guard for enabling unrestricted mode: file tools immediately gain access to
 * ANY path on the system, so this is a policy-governed elevation, not a plain
 * setting. Only an operator env opt-in (HOOSHIX_UNRESTRICTED) seeds it at boot;
 * no tool can elevate at runtime — the unrestricted capability was removed from
 * set_workspace entirely (security-design regression: a pure selector must not
 * carry privilege expansion). Disabling is always free.
 */
export function assertUnrestrictedElevationAllowed(): void {
  throw new Error("Approval required: unrestricted mode cannot be enabled at runtime — no tool carries that capability. Use HOOSHIX_UNRESTRICTED=1 at server boot instead.");
}

/**
 * Bootstrap/test-only seeding for unrestricted mode (mirrors the
 * HOOSHIX_UNRESTRICTED=1 boot path). NEVER exposed as an MCP tool or reachable
 * from any tool/executor/governance path — the runtime elevation gate above
 * stays hard for everything else.
 */
export function seedUnrestrictedMode(enabled: boolean): void {
  unrestrictedMode = enabled;
}

/** Enable/disable unrestricted mode (absolute paths work anywhere) */
export function setUnrestrictedMode(enabled: boolean): void {
  if (enabled && !unrestrictedMode) assertUnrestrictedElevationAllowed();
  unrestrictedMode = enabled;
}

/** Check if unrestricted mode is active */
export function isUnrestrictedMode(): boolean {
  return unrestrictedMode;
}

/**
 * Resolve + classify a command cwd against the ACTIVE workspace — shared by
 * governance (which must classify cwd escalations BEFORE execution, so the
 * task loop pauses for approval instead of the executor auto-satisfying the
 * gate) and by validateCommandCwd (the enforcement point at execution time).
 * Mirrors validateCommandCwd's resolution exactly (existence walk + realpath)
 * so the two can never disagree. Unresolvable/nonexistent paths classify as
 * OUTSIDE (fail-closed).
 */
export function classifyCommandCwd(cwd: string): { cwd: string; inside: boolean } {
  const resolved = path.resolve(cwd);
  // No active workspace configured — nothing can be inside it (fail-closed).
  const activeRoot = activeWorkspace;
  if (activeRoot === null) return { cwd: resolved, inside: false };
  if (!fs.existsSync(resolved)) return { cwd: resolved, inside: false };
  let existing = resolved;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) return { cwd: resolved, inside: false };
    existing = parent;
  }
  const real = fs.realpathSync(existing);
  const relative = path.relative(activeRoot, real);
  const inside = !relative.startsWith("..") && !path.isAbsolute(relative);
  return { cwd: real, inside };
}

/**
 * Validate that a subprocess working directory is allowed. The cwd must be
 * inside the ACTIVE workspace; anything else is an escalation that requires
 * approval (run inside an approved task step) or explicit direct-call opt-in
 * (HOOSHIX_DIRECT_AUTO_APPROVE=1). Unrestricted mode does NOT bypass this —
 * it only widens FILE tools; subprocess scope is governed separately.
 * Returns the resolved, realpath'd cwd.
 */
export function validateCommandCwd(cwd: string): string {
  const { cwd: real, inside } = classifyCommandCwd(cwd);
  if (!fs.existsSync(real)) {
    throw new Error(`Working directory does not exist: ${real}`);
  }
  if (!inside) {
    policyDecisionPoint.assertAllowed({
      tool: "execute_command",
      arguments: { cwdOutsideWorkspace: true },
    });
  }
  return real;
}

function assertInside(allowedRoots: string[], target: string): void {
  for (const root of allowedRoots) {
    const relative = path.relative(root, target);
    if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
      return; // Found a matching root
    }
  }
  throw new Error(`Access denied: path outside workspace. Allowed: ${allowedRoots.join(", ")}. Use set_workspace to add this directory.`);
}

export function validateWorkspace(targetPath: string): string {
  initWorkspaceRoots();
  // Empty-by-default pool: with no active workspace, file tools operate
  // NOWHERE — every path is outside (fail-closed) until a workspace is set.
  const root = activeWorkspace;
  if (root === null) {
    throw new Error(
      "Access denied: no active workspace. Add a root with add_workspace_roots and select it with set_workspace first."
    );
  }
  
  // Absolute path: in unrestricted mode, allow any path on the system
  if (path.isAbsolute(targetPath)) {
    const resolved = path.resolve(targetPath);
    
    if (unrestrictedMode) {
      // Unrestricted: allow any absolute path, just resolve symlinks for existing files
      try {
        if (fs.existsSync(resolved)) {
          return fs.realpathSync(resolved);
        }
      } catch {
        // Symlink resolution failed, use resolved path
      }
      return resolved;
    }
    
    // Restricted: file tools are scoped to the ACTIVE workspace only — other
    // configured roots are NOT implicitly accessible (least privilege).
    assertInside([root], resolved);
    let existing = resolved;
    while (!fs.existsSync(existing)) {
      const parent = path.dirname(existing);
      if (parent === existing) throw new Error("Access denied: invalid path");
      existing = parent;
    }
    assertInside([root], fs.realpathSync(existing));
    if (fs.existsSync(resolved)) assertInside([root], fs.realpathSync(resolved));
    return resolved;
  }
  
  // Relative path — resolve against active workspace
  const resolved = path.resolve(root, targetPath);
  assertInside([root], resolved);

  let existing = resolved;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) throw new Error("Access denied: invalid workspace path");
    existing = parent;
  }
  assertInside([root], fs.realpathSync(existing));
  if (fs.existsSync(resolved)) assertInside([root], fs.realpathSync(resolved));
  return resolved;
}
