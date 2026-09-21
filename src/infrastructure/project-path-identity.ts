import fs from "node:fs";
import path from "node:path";

/** Canonical project identity shared by migration preflight and runtime writes.
 * Existing symlinks/junctions are resolved; absent paths retain a normalized,
 * absolute lexical identity. Windows identities are case-insensitive. */
export function canonicalProjectPath(input: string): string {
  if (!input.trim()) throw new Error("project_path_required");
  const lexical = path.normalize(path.resolve(input));
  const real = fs.existsSync(lexical) ? fs.realpathSync.native(lexical) : lexical;
  const canonical = path.normalize(real);
  return process.platform === "win32" ? canonical.toLowerCase() : canonical;
}
