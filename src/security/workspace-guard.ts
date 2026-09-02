import fs from "node:fs";
import path from "node:path";

function workspaceRoot(): string {
  const configured = path.resolve(process.env.HOOSHIX_WORKSPACE ?? process.cwd());
  return fs.realpathSync(configured);
}

function assertInside(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Access denied: path outside workspace");
  }
}

export function validateWorkspace(targetPath: string): string {
  const root = workspaceRoot();
  const resolved = path.resolve(root, targetPath);
  assertInside(root, resolved);

  let existing = resolved;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) throw new Error("Access denied: invalid workspace path");
    existing = parent;
  }
  assertInside(root, fs.realpathSync(existing));
  if (fs.existsSync(resolved)) assertInside(root, fs.realpathSync(resolved));
  return resolved;
}
