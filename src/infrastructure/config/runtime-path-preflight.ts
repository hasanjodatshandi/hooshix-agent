/**
 * Boot-time writability preflight for the three paths a host has to touch
 * before it can serve: the log directory, the database file's directory, and
 * the bootstrap token file's directory.
 */
import fs from "node:fs";
import path from "node:path";

export interface RuntimePathConfig {
  readonly databasePath: string;
  readonly logDirectory: string;
  readonly bootstrapTokenFile: string;
}

export interface ResolvedRuntimePaths {
  readonly logDirectory: string;
  readonly databaseDirectory: string;
  readonly tokenDirectory: string;
}

interface PathObligation {
  readonly label: string;
  readonly envVar: string;
  readonly directory: string;
}

/**
 * A boot-start service runs as an account with no interactive profile, and its
 * working directory is normally `C:\Windows\System32`. Relative defaults then
 * resolve into the Windows directory, which LocalSystem can write to — so a
 * plain writability probe would pass while littering the OS folder. The system
 * root is refused explicitly instead.
 */
function isInsideSystemRoot(directory: string): boolean {
  const systemRoot = process.env.SystemRoot ?? process.env.windir;
  if (!systemRoot) return false;
  const root = path.resolve(systemRoot);
  return directory === root || directory.startsWith(root + path.sep);
}

function obligations(config: RuntimePathConfig): PathObligation[] {
  return [
    { label: "log directory", envVar: "HOOSHIX_LOG_DIR", directory: path.resolve(config.logDirectory) },
    { label: "database directory", envVar: "HOOSHIX_DB_PATH", directory: path.resolve(path.dirname(config.databasePath)) },
    { label: "bootstrap token directory", envVar: "HOOSHIX_BOOTSTRAP_TOKEN_FILE", directory: path.resolve(path.dirname(config.bootstrapTokenFile)) },
  ];
}

function assertWritable(obligation: PathObligation): void {
  const { directory, envVar, label } = obligation;
  const refusal = (reason: string) =>
    new Error(`Unusable ${label}: "${directory}" ${reason}. A Windows service starts before any user logs in, `
      + `so set ${envVar} to an absolute path in a writable data location (for example %ProgramData%\\HooshiXMCP).`);

  if (isInsideSystemRoot(directory)) throw refusal("resolves inside the Windows directory");

  try {
    fs.mkdirSync(directory, { recursive: true });
  } catch (error) {
    throw refusal(`cannot be created (${error instanceof Error ? error.message : String(error)})`);
  }

  // A probe write, not fs.access: on Windows ACCESS.WRITE on a directory reports
  // success even when creation of the file the host actually needs would fail.
  const probe = path.join(directory, `.hooshix-write-probe-${process.pid}`);
  try {
    fs.writeFileSync(probe, "", { flag: "wx" });
  } catch (error) {
    throw refusal(`is not writable (${error instanceof Error ? error.message : String(error)})`);
  } finally {
    fs.rmSync(probe, { force: true });
  }
}

export function assertWritableRuntimePaths(config: RuntimePathConfig): ResolvedRuntimePaths {
  for (const obligation of obligations(config)) assertWritable(obligation);
  return {
    logDirectory: path.resolve(config.logDirectory),
    databaseDirectory: path.resolve(path.dirname(config.databasePath)),
    tokenDirectory: path.resolve(path.dirname(config.bootstrapTokenFile)),
  };
}
