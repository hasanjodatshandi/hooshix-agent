import type { AuthorizedPath } from "../../../domain/workspace/workspace-scope.js";
import type { ExecutionId, ToolId } from "../../../domain/shared/ids.js";
export interface PathCanonicalizerPort {
  resolve(input: string, base?: string): Promise<string>;
  realpathNearestExisting(input: string): Promise<string>;
  exists(input: string): Promise<boolean>;
  isDirectory(input: string): Promise<boolean>;
  relative(from: string, to: string): string;
}
export interface FileSystemPort {
  readText(path: AuthorizedPath, maxBytes: number): Promise<{ readonly text: string; readonly revision: string }>;
  list(path: AuthorizedPath, maxEntries: number): Promise<readonly { readonly name: string; readonly kind: "file" | "directory" }[]>;
  atomicWrite(path: AuthorizedPath, content: Uint8Array): Promise<{ readonly revision: string }>;
  createExclusive(path: AuthorizedPath, content: Uint8Array): Promise<{ readonly revision: string }>;
  delete(path: AuthorizedPath): Promise<{ readonly effectId: string }>;
  revision(path: AuthorizedPath): Promise<string | null>;
}
export interface AuthorizedProcessCommand {
  readonly executionId: ExecutionId;
  readonly executable: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string,string>>;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}
export interface ProcessRunnerPort {
  execute(command: AuthorizedProcessCommand): Promise<{ readonly kind: "completed" | "failed_known" | "outcome_unknown"; readonly code?: number; readonly stdout?: string; readonly stderr?: string }>;
  terminate(executionId: ExecutionId, graceMs: number): Promise<"terminated" | "completed" | "unknown">;
}
export interface GitPort {
  status(scope: string): Promise<{ readonly clean: boolean; readonly head: string }>;
  diff(scope: string, paths: readonly string[]): Promise<string>;
  commit(scope: string, message: string): Promise<{ readonly commit: string }>;
}
export interface PackageManagerPort {
  readonly manager: string;
  install(request: { readonly cwd: string; readonly name: string }): Promise<{ readonly effectId: string }>;
  inspectManifestState(cwd: string): Promise<Readonly<Record<string,string>>>;
}
export interface ToolInputValidatorPort {
  validate(toolId: ToolId, input: unknown): { readonly valid: true; readonly value: unknown } | { readonly valid: false; readonly reason: string };
}
