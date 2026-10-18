import fs from "node:fs";
import { WorkspaceContextInvalidError } from "../core/errors.js";
import {isWSLWorkspaceURI} from "./wsl-workspace-uri.js";
import {getWSLWorkspaceBinding} from "./wsl-workspace-binding.js";
import {probeWSLWorkspace} from "./wsl-workspace-client.js";
import {
  canonicalizeWorkspacePath,
  listPersistedWorkspaceRoots,
  workspaceIdentity,
} from "./workspace-policy-repository.js";

export type WorkspaceContextInvalidReason =
  | "ROOT_NO_LONGER_ALLOWED"
  | "PATH_NO_LONGER_EXISTS"
  | "WORKSPACE_NOT_CONFIGURED"
  | "WORKSPACE_CANONICALIZATION_FAILED";

export interface TaskWorkspaceContext {
  workspace: string | null;
  source: "task_context" | "none";
}

/** Resolve a persisted task workspace against current policy; never auto-authorize or fallback. */
export function resolveTaskWorkspace(executionContext: { workspace: string | null } | undefined): TaskWorkspaceContext {
  const requested = executionContext?.workspace ?? null;
  if (!requested) return { workspace: null, source: "none" };

  let canonical: string;
  try {
    canonical = canonicalizeWorkspacePath(requested);
  } catch (error) {
    throw new WorkspaceContextInvalidError("WORKSPACE_CANONICALIZATION_FAILED", requested, error instanceof Error ? error.message : String(error));
  }
  if (isWSLWorkspaceURI(canonical)) {
    // Windows LocalSystem cannot stat Linux. Re-attest the pinned root
    // through an owner-SID-bound worker; never substitute host CWD.
    const binding = getWSLWorkspaceBinding(canonical);
    if (!binding || !probeWSLWorkspace(binding))
      throw new WorkspaceContextInvalidError("PATH_NO_LONGER_EXISTS", canonical);
  } else if (!fs.existsSync(canonical)) {
    throw new WorkspaceContextInvalidError("PATH_NO_LONGER_EXISTS", canonical);
  }
  const allowed = listPersistedWorkspaceRoots().some(
    (root) => workspaceIdentity(root.path) === workspaceIdentity(canonical),
  );
  if (!allowed) {
    throw new WorkspaceContextInvalidError("ROOT_NO_LONGER_ALLOWED", canonical);
  }
  return { workspace: canonical, source: "task_context" };
}