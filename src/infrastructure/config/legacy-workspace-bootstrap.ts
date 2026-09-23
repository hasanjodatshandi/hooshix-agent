/**
 * R7.01 compatibility projection over the single workspace parser in
 * `app-config.ts`. This does not authorize new roots or unrestricted mode.
 */
import { parseWorkspaceSettings, type WorkspaceSettings } from "./app-config.js";

export type LegacyWorkspaceBootstrapSettings = WorkspaceSettings;

export const readLegacyWorkspaceBootstrapSettings = parseWorkspaceSettings;
