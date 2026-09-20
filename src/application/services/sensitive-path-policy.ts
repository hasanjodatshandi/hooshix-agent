/** Shared, pure path-deny policy for read, search, traversal, and mutations. */
const SENSITIVE_BASENAMES = new Set([
  ".token", ".env", ".env.local", ".env.development", ".env.production",
  ".env.staging", ".env.test", "id_rsa", "id_ecdsa", "id_ed25519", "id_dsa",
  ".npmrc", ".pypirc", ".netrc", ".htpasswd", "credentials.json",
  "secrets.json", "secrets.yaml", "secrets.yml",
]);
const SENSITIVE_EXTENSIONS = new Set([".pem", ".key", ".pfx", ".p12", ".kdbx"]);
const SENSITIVE_DIRS = [".ssh", ".gnupg", ".aws", ".azure"];

export function isSensitivePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  const basename = normalized.slice(normalized.lastIndexOf("/") + 1);
  if (SENSITIVE_BASENAMES.has(basename)) return true;
  const segments = normalized.split("/").filter(Boolean);
  if (segments.some((segment) => SENSITIVE_DIRS.includes(segment))) return true;
  const dot = basename.lastIndexOf(".");
  if (dot > 0 && SENSITIVE_EXTENSIONS.has(basename.slice(dot))) return true;
  // .env.* (e.g. .env.docker)
  if (basename.startsWith(".env.")) return true;
  return false;
}
