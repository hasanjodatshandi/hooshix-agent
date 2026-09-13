import fs from "node:fs";
import path from "node:path";
import { policyDecisionPoint } from "../core/governance/policy-decision-point.js";

// Supported workspace roots (comma-separated in env var)
let workspaceRoots: string[] = [];
let activeWorkspace: string | null = null;

function initWorkspaceRoots(): string[] {
  if (workspaceRoots.length > 0) return workspaceRoots;
  const envValue = process.env.HOOSHIX_WORKSPACE ?? process.cwd();
  workspaceRoots = envValue
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
  // Auto-enable unrestricted mode from env
  if (process.env.HOOSHIX_UNRESTRICTED === "1" || process.env.HOOSHIX_UNRESTRICTED === "true") {
    unrestrictedMode = true;
  }
  return workspaceRoots;
}

/** Get the active workspace root (first configured by default) */
export function getWorkspaceRoot(): string {
  initWorkspaceRoots();
  return activeWorkspace ?? workspaceRoots[0];
}

/** Set the active workspace root. Returns { resolved, previous } */
export function setActiveWorkspace(rootPath: string): { resolved: string; previous: string | null } {
  const resolved = path.resolve(rootPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Workspace path does not exist: ${resolved}`);
  }
  const real = fs.realpathSync(resolved);
  const previous = activeWorkspace;
  activeWorkspace = real;
  // Ensure it's in the allowed list
  initWorkspaceRoots();
  if (!workspaceRoots.includes(real)) {
    workspaceRoots.push(real);
  }
  // NOTE: unrestricted mode is NOT enabled implicitly — enabling it is a
  // separate, explicit decision (setUnrestrictedMode(true) / HOOSHIX_UNRESTRICTED).
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

/** Remove a workspace root by path */
export function removeWorkspaceRoot(rootPath: string): boolean {
  initWorkspaceRoots();
  const resolved = path.resolve(rootPath);
  const index = workspaceRoots.findIndex((r) => r === resolved || r === path.normalize(resolved));
  if (index === -1) return false;
  workspaceRoots.splice(index, 1);
  return true;
}

/** Replace all workspace roots with a single new root */
export function replaceWorkspaceRoots(rootPath: string): string[] {
  const resolved = path.resolve(rootPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Workspace path does not exist: ${resolved}`);
  }
  const real = fs.realpathSync(resolved);
  workspaceRoots = [real];
  activeWorkspace = real;
  return [...workspaceRoots];
}

let unrestrictedMode = false;

/**
 * Guard for enabling unrestricted mode: file tools immediately gain access to
 * ANY path on the system, so this is a policy-governed elevation, not a plain
 * setting. Approved task steps pass (they run inside runWithPolicyApproval);
 * direct MCP calls require HOOSHIX_DIRECT_AUTO_APPROVE=1. Disabling is free.
 * Throws instead of returning a decision so every caller (MCP tool + executor
 * handler) is covered by the same gate (audit HIGH-01 / R2.05).
 */
export function assertUnrestrictedElevationAllowed(): void {
  policyDecisionPoint.assertAllowed({ tool: "set_workspace", arguments: { unrestricted: true } });
}

/** Enable/disable unrestricted mode (absolute paths work anywhere) */
export function setUnrestrictedMode(enabled: boolean): void {
  if (enabled) assertUnrestrictedElevationAllowed();
  unrestrictedMode = enabled;
}

/** Check if unrestricted mode is active */
export function isUnrestrictedMode(): boolean {
  return unrestrictedMode;
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
  const roots = initWorkspaceRoots();
  
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
    
    // Restricted: check if inside any allowed root
    assertInside(roots, resolved);
    let existing = resolved;
    while (!fs.existsSync(existing)) {
      const parent = path.dirname(existing);
      if (parent === existing) throw new Error("Access denied: invalid path");
      existing = parent;
    }
    assertInside(roots, fs.realpathSync(existing));
    if (fs.existsSync(resolved)) assertInside(roots, fs.realpathSync(resolved));
    return resolved;
  }
  
  // Relative path — resolve against active workspace
  const root = getWorkspaceRoot();
  const resolved = path.resolve(root, targetPath);
  assertInside(roots, resolved);

  let existing = resolved;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) throw new Error("Access denied: invalid workspace path");
    existing = parent;
  }
  assertInside(roots, fs.realpathSync(existing));
  if (fs.existsSync(resolved)) assertInside(roots, fs.realpathSync(resolved));
  return resolved;
}
