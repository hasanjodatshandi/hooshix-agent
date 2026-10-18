import { spawn } from "../spawn.js";

/**
 * A bounded, read-only Git readiness probe for one previously authorized root.
 * Never marks an unowned repository as safe; that needs explicit operator trust.
 * No subprocess stderr or local account details are exposed to MCP clients.
 */
export type GitReadiness =
  | { status: "ready" }
  | { status: "untrusted_owner"; advice: string }
  | { status: "not_repository" }
  | { status: "unavailable"; advice: string };

export async function inspectGitReadiness(root: string): Promise<GitReadiness> {
  try {
    const result = await spawn("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: root, shell: false, reject: false, timeout: 5000,
    });
    if (result.exitCode === 0 && result.stdout.trim() === "true")
      return { status: "ready" };
    if (/dubious ownership/i.test(result.stderr))
      return {
        status: "untrusted_owner",
        advice: "Git refused cross-owner repository access. Use a repository-owner process or have an operator explicitly approve this exact repository for the service identity. HooshiX does not bypass Git's trust check.",
      };
    if (/not a git repository/i.test(result.stderr))
      return { status: "not_repository" };
  } catch {
    // Git may not be installed. File tools must remain usable.
  }
  return {
    status: "unavailable",
    advice: "Git readiness could not be verified in the server account. Check that Git is installed and reachable, then inspect the service's diagnostic logs.",
  };
}