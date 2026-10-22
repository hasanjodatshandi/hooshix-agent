import { getTrustedInboundIdentity } from "../core/runtime/r2-trusted-inbound-identity.js";
import {
  findPersistedWSLBinding,
  registerPersistedWSLBinding,
  unregisterPersistedWSLBinding,
} from "../adapters/outbound/persistence/sqlite/repositories/workspace-policy-repository.adapter.js";
import { parseWSLWorkspaceURI, type WSLWorkspaceURI } from "./wsl-workspace-uri.js";

export interface WSLWorkspaceBinding extends WSLWorkspaceURI {
  ownerWindowsRoot: string;
}

/** Windows owner SID and MCP credential identity are independent trust boundaries. */
function principalId(): string {
  return String(getTrustedInboundIdentity().principal.id);
}

export function getWSLWorkspaceBinding(uri: string): WSLWorkspaceBinding | null {
  const parsed = parseWSLWorkspaceURI(uri);
  if (!parsed) return null;
  const row = findPersistedWSLBinding(parsed.uri, principalId());
  if (!row || row.distro !== parsed.distro || row.linuxRoot !== parsed.linuxRoot)
    return null;
  return {...parsed, ownerWindowsRoot: row.ownerWindowsRoot};
}

export function persistWSLWorkspaceBinding(binding: WSLWorkspaceBinding): void {
  const parsed = parseWSLWorkspaceURI(binding.uri);
  if (!parsed || parsed.distro !== binding.distro || parsed.linuxRoot !== binding.linuxRoot)
    throw new Error("wsl_binding_identity_mismatch");
  registerPersistedWSLBinding(binding, principalId());
}

export function revokeWSLWorkspaceBinding(uri: string): void {
  unregisterPersistedWSLBinding(uri, principalId());
}
