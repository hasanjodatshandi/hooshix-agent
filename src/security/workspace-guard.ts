import fs from "node:fs";
import path from "node:path";

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
  return workspaceRoots;
}

/** Get the active workspace root (first configured by default) */
export function getWorkspaceRoot(): string {
  initWorkspaceRoots();
  return activeWorkspace ?? workspaceRoots[0];
}

/** Set the active workspace root */
export function setActiveWorkspace(rootPath: string): string {
  const resolved = path.resolve(rootPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Workspace path does not exist: ${resolved}`);
  }
  const real = fs.realpathSync(resolved);
  activeWorkspace = real;
  // Ensure it's in the allowed list
  initWorkspaceRoots();
  if (!workspaceRoots.includes(real)) {
    workspaceRoots.push(real);
  }
  return real;
}

/** List all configured workspace roots */
export function listWorkspaceRoots(): string[] {
  initWorkspaceRoots();
  return [...workspaceRoots];
}

function assertInside(allowedRoots: string[], target: string): void {
  for (const root of allowedRoots) {
    const relative = path.relative(root, target);
    if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
      return; // Found a matching root
    }
  }
  throw new Error(`Access denied: path outside workspace. Allowed: ${allowedRoots.join(", ")}`);
}

export function validateWorkspace(targetPath: string): string {
  const roots = initWorkspaceRoots();
  
  // If absolute path and exists, check if it's inside any allowed root
  if (path.isAbsolute(targetPath)) {
    const resolved = path.resolve(targetPath);
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
