/** Canonical package manager names shared by inbound schema and the runtime executor. */
export const PACKAGE_MANAGERS = [
  "npm", "pnpm", "yarn", "bun",
  "pip", "uv", "poetry",
  "cargo", "dotnet", "composer", "bundler", "gem", "go",
  "maven", "gradle",
  "winget", "choco", "brew", "apt", "dnf", "pacman", "zypper",
] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];
