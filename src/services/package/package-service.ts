import { spawn, type SpawnOptions } from "../spawn.js";
import { validateWorkspace } from "../../security/workspace-guard.js";
import { assertAdminPermission } from "../../security/permission.js";
import { policyDecisionPoint } from "../../core/governance/policy-decision-point.js";
import { logCommandAction } from "../../memory/command-audit.js";
import { resolveCorrelationId } from "../../core/runtime/correlation-id.js";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { insertPackageSnapshot, updateStoredPackageSnapshot } from "../../adapters/outbound/persistence/sqlite/repositories/package-snapshot.adapter.js";
import { assertCwdExists, describeExecaFailure } from "../execa-result.js";

/**
 * Canonical package-manager list. Single source of truth — the zod schemas in
 * tools/package/index.ts and core/executor/handlers/package-handler.ts are
 * derived from this tuple so the registry can never drift from the service.
 */
import type { PackageManager } from "../../application/services/package-managers.js";
export { PACKAGE_MANAGERS, type PackageManager } from "../../application/services/package-managers.js";
export type PackageAction = "install" | "remove" | "update";

/** Managers that install OS-wide software and therefore require ADMIN_MODE. */
const ADMIN_MANAGERS: ReadonlySet<PackageManager> = new Set([
  "winget", "choco", "apt", "dnf", "pacman", "zypper",
]);

interface PackageSnapshotFile { path: string; existed: boolean; content?: string }
interface PackageSnapshot { id: string; files: PackageSnapshotFile[] }

/**
 * Manifest files snapshotted before the operation so a failed package install
 * can be compensated. Entries may be exact file names or simple top-level globs ("*.csproj").
 * System-level managers (winget/choco/brew/apt/dnf/pacman/zypper) and `gem`
 * mutate machine state outside the workspace — nothing to snapshot.
 */
const SNAPSHOT_FILES: Record<PackageManager, readonly string[]> = {
  npm: ["package.json", "package-lock.json", "npm-shrinkwrap.json"],
  pnpm: ["package.json", "pnpm-lock.yaml"],
  yarn: ["package.json", "yarn.lock"],
  bun: ["package.json", "bun.lock", "bun.lockb"],
  pip: ["requirements.txt", "pyproject.toml", "poetry.lock", ".python-version"],
  uv: ["pyproject.toml", "uv.lock", "requirements.txt"],
  poetry: ["pyproject.toml", "poetry.lock"],
  cargo: ["Cargo.toml", "Cargo.lock"],
  dotnet: ["*.csproj", "*.fsproj", "*.vbproj", "packages.config"],
  composer: ["composer.json", "composer.lock"],
  bundler: ["Gemfile", "Gemfile.lock"],
  gem: [],
  go: ["go.mod", "go.sum"],
  maven: ["pom.xml"],
  gradle: ["build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"],
  winget: [],
  choco: [],
  brew: [],
  apt: [],
  dnf: [],
  pacman: [],
  zypper: []
};
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const MAX_GLOB_MATCHES = 10;

interface CommandSpec { command: string; args: string[] }

/**
 * Command table: how each manager performs install/remove/update.
 * A missing action means the manager has no CLI form for it — commandFor
 * throws a clear error instead of guessing. `go`/`maven` re-install latest
 * for update; `cargo` update is `install --force`; `dotnet` update re-adds
 * the package (restoring the latest version).
 */
const COMMANDS: Record<PackageManager, Partial<Record<PackageAction, (name: string) => CommandSpec>>> = {
  npm: {
    install: (n) => ({ command: "npm", args: ["install", n] }),
    remove: (n) => ({ command: "npm", args: ["uninstall", n] }),
    update: (n) => ({ command: "npm", args: ["update", n] }),
  },
  pnpm: {
    install: (n) => ({ command: "pnpm", args: ["add", n] }),
    remove: (n) => ({ command: "pnpm", args: ["remove", n] }),
    update: (n) => ({ command: "pnpm", args: ["update", n] }),
  },
  yarn: {
    install: (n) => ({ command: "yarn", args: ["add", n] }),
    remove: (n) => ({ command: "yarn", args: ["remove", n] }),
    update: (n) => ({ command: "yarn", args: ["upgrade", n] }),
  },
  bun: {
    install: (n) => ({ command: "bun", args: ["add", n] }),
    remove: (n) => ({ command: "bun", args: ["remove", n] }),
    update: (n) => ({ command: "bun", args: ["update", n] }),
  },
  pip: {
    install: (n) => ({ command: "python", args: ["-m", "pip", "install", n] }),
    remove: (n) => ({ command: "python", args: ["-m", "pip", "uninstall", "-y", n] }),
    update: (n) => ({ command: "python", args: ["-m", "pip", "install", "--upgrade", n] }),
  },
  uv: {
    install: (n) => ({ command: "uv", args: ["pip", "install", n] }),
    remove: (n) => ({ command: "uv", args: ["pip", "uninstall", n] }),
    update: (n) => ({ command: "uv", args: ["pip", "install", "--upgrade", n] }),
  },
  poetry: {
    install: (n) => ({ command: "poetry", args: ["add", n] }),
    remove: (n) => ({ command: "poetry", args: ["remove", n] }),
    update: (n) => ({ command: "poetry", args: ["update", n] }),
  },
  cargo: {
    install: (n) => ({ command: "cargo", args: ["install", n] }),
    remove: (n) => ({ command: "cargo", args: ["uninstall", n] }),
    update: (n) => ({ command: "cargo", args: ["install", "--force", n] }),
  },
  dotnet: {
    install: (n) => ({ command: "dotnet", args: ["add", "package", n] }),
    remove: (n) => ({ command: "dotnet", args: ["remove", "package", n] }),
    update: (n) => ({ command: "dotnet", args: ["add", "package", n] }),
  },
  composer: {
    install: (n) => ({ command: "composer", args: ["require", n] }),
    remove: (n) => ({ command: "composer", args: ["remove", n] }),
    update: (n) => ({ command: "composer", args: ["update", n] }),
  },
  bundler: {
    install: (n) => ({ command: "bundle", args: ["add", n] }),
    remove: (n) => ({ command: "bundle", args: ["remove", n] }),
    update: (n) => ({ command: "bundle", args: ["update", n] }),
  },
  gem: {
    install: (n) => ({ command: "gem", args: ["install", n] }),
    remove: (n) => ({ command: "gem", args: ["uninstall", n] }),
    update: (n) => ({ command: "gem", args: ["update", n] }),
  },
  go: {
    install: (n) => ({ command: "go", args: ["install", `${n}@latest`] }),
    update: (n) => ({ command: "go", args: ["install", `${n}@latest`] }),
  },
  maven: {
    install: (n) => ({ command: "mvn", args: ["dependency:get", `-Dartifact=${n}`] }),
  },
  gradle: {
    // Dependency management is declarative (build.gradle) — no CLI install.
  },
  winget: {
    install: (n) => ({ command: "winget", args: ["install", "--id", n, "--exact", "--accept-source-agreements"] }),
    remove: (n) => ({ command: "winget", args: ["uninstall", "--id", n, "--exact", "--accept-source-agreements"] }),
    update: (n) => ({ command: "winget", args: ["upgrade", "--id", n, "--exact", "--accept-source-agreements"] }),
  },
  choco: {
    install: (n) => ({ command: "choco", args: ["install", n, "-y"] }),
    remove: (n) => ({ command: "choco", args: ["uninstall", n, "-y"] }),
    update: (n) => ({ command: "choco", args: ["upgrade", n, "-y"] }),
  },
  brew: {
    install: (n) => ({ command: "brew", args: ["install", n] }),
    remove: (n) => ({ command: "brew", args: ["uninstall", n] }),
    update: (n) => ({ command: "brew", args: ["upgrade", n] }),
  },
  apt: {
    install: (n) => ({ command: "apt-get", args: ["install", "-y", n] }),
    remove: (n) => ({ command: "apt-get", args: ["remove", "-y", n] }),
    update: (n) => ({ command: "apt-get", args: ["install", "--only-upgrade", "-y", n] }),
  },
  dnf: {
    install: (n) => ({ command: "dnf", args: ["install", "-y", n] }),
    remove: (n) => ({ command: "dnf", args: ["remove", "-y", n] }),
    update: (n) => ({ command: "dnf", args: ["upgrade", "-y", n] }),
  },
  pacman: {
    install: (n) => ({ command: "pacman", args: ["-S", "--noconfirm", n] }),
    remove: (n) => ({ command: "pacman", args: ["-R", "--noconfirm", n] }),
    update: (n) => ({ command: "pacman", args: ["-S", "--noconfirm", n] }),
  },
  zypper: {
    install: (n) => ({ command: "zypper", args: ["--non-interactive", "install", n] }),
    remove: (n) => ({ command: "zypper", args: ["--non-interactive", "remove", n] }),
    update: (n) => ({ command: "zypper", args: ["--non-interactive", "update", n] }),
  },
};

async function captureSnapshotFile(cwd:string,relative:string,files:PackageSnapshotFile[],bytes:{value:number}):Promise<void>{
  const file=validateWorkspace(path.join(cwd,relative));
  const stat=await fs.lstat(file).catch((error:NodeJS.ErrnoException)=>error.code==="ENOENT"?undefined:Promise.reject(error));
  if(!stat){files.push({path:relative,existed:false});return;}
  if(!stat.isFile()||stat.isSymbolicLink())
    throw new Error("PACKAGE_MANIFEST_UNSAFE_TARGET: manifest must be a regular non-symlink file");
  bytes.value+=stat.size;
  if(bytes.value>MAX_SNAPSHOT_BYTES)throw new Error("Package snapshot exceeds the 8 MiB limit");
  const content=await fs.readFile(file);
  if(content.length!==stat.size)throw new Error("PACKAGE_MANIFEST_CHANGED_DURING_CAPTURE");
  files.push({path:relative,existed:true,content:content.toString("base64")});
}

/** Simple top-level glob match for "*.csproj"-style patterns. */
function matchesGlob(fileName: string, pattern: string): boolean {
  const star = pattern.indexOf("*");
  if (star < 0) return fileName === pattern;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  return fileName.startsWith(prefix) && fileName.endsWith(suffix);
}

async function createPackageSnapshot(manager: PackageManager, action: PackageAction, name: string, cwd: string, correlationId: string): Promise<PackageSnapshot> {
  const id = randomUUID();
  const files: PackageSnapshotFile[] = [];
  const bytes = { value: 0 };
  for (const entry of SNAPSHOT_FILES[manager]) {
    if (!entry.includes("*")) {
      await captureSnapshotFile(cwd, entry, files, bytes);
      continue;
    }
    // Glob entry: snapshot every top-level project file matching it (bounded).
    let entries: string[] = [];
    try { entries = await fs.readdir(cwd); } catch { /* unreadable cwd — treat as no matches */ }
    const matched = entries.filter((e) => matchesGlob(e, entry)).slice(0, MAX_GLOB_MATCHES);
    for (const file of matched) await captureSnapshotFile(cwd, file, files, bytes);
  }
  insertPackageSnapshot({
    id, correlationId, manager, action, packageName: name, cwd,
    snapshot: { files, environment: { platform: process.platform, architecture: process.arch, nodeVersion: process.version, manager } },
  });
  return { id, files };
}

/** Restore ONLY supported, previously captured manifest files and verify their
 * exact bytes/absence. Never claim installed-environment reversal. */
async function restorePackageSnapshot(snapshot:PackageSnapshot,cwd:string,manager:PackageManager):Promise<string[]>{
  if(!Array.isArray(snapshot.files))throw new Error("PACKAGE_MANIFEST_SNAPSHOT_INVALID");
  if(SNAPSHOT_FILES[manager].length===0)throw new Error("PACKAGE_MANIFEST_RESTORE_UNSUPPORTED: manager has no captured manifest contract");
  const allowed=SNAPSHOT_FILES[manager];
  const seen=new Set<string>();let totalBytes=0;
  const entries:Array<{destination:string;existed:boolean;content?:Buffer}>=[];
  // Fail closed before the first write/delete if any entry is malformed,
  // unexpected for the manager, out-of-scope or a symlink.
  for(const item of snapshot.files){
    if(!item||typeof item.path!=="string"||item.path!==path.basename(item.path)||
       item.path==="."||item.path===".."||/[\\/\u0000]/.test(item.path)||
       !allowed.some(pattern=>matchesGlob(item.path,pattern))||seen.has(item.path)||
       typeof item.existed!=="boolean")
      throw new Error("PACKAGE_MANIFEST_SNAPSHOT_INVALID: unrecognized or unsafe manifest entry");
    seen.add(item.path);
    const destination=validateWorkspace(path.join(cwd,item.path));
    const stat=await fs.lstat(destination).catch((e:NodeJS.ErrnoException)=>e.code==="ENOENT"?undefined:Promise.reject(e));
    if(stat&&(!stat.isFile()||stat.isSymbolicLink()))
      throw new Error("PACKAGE_MANIFEST_UNSAFE_TARGET: target is not a regular file");
    if(item.existed){
      if(typeof item.content!=="string"||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.content))
        throw new Error("PACKAGE_MANIFEST_SNAPSHOT_INVALID: malformed binary content");
      const content=Buffer.from(item.content,"base64");
      if(content.toString("base64")!==item.content)throw new Error("PACKAGE_MANIFEST_SNAPSHOT_INVALID: invalid base64");
      totalBytes+=content.byteLength;
      if(totalBytes>MAX_SNAPSHOT_BYTES)throw new Error("Package snapshot exceeds the 8 MiB limit");
      entries.push({destination,existed:true,content});
    }else{
      if(item.content!==undefined)throw new Error("PACKAGE_MANIFEST_SNAPSHOT_INVALID: absent entry has content");
      entries.push({destination,existed:false});
    }
  }
  for(const entry of entries){
    if(!entry.existed){await fs.rm(entry.destination,{force:true});continue;}
    const temporary=`${entry.destination}.${randomUUID()}.manifest-restore`;
    try{
      await fs.writeFile(temporary,entry.content!,{flag:"wx"});
      await fs.rename(temporary,entry.destination);
    }finally{await fs.rm(temporary,{force:true}).catch(()=>{});}
  }
  for(const entry of entries){
    const stat=await fs.lstat(entry.destination).catch((e:NodeJS.ErrnoException)=>e.code==="ENOENT"?undefined:Promise.reject(e));
    if(!entry.existed){if(stat)throw new Error("PACKAGE_MANIFEST_RESTORE_VERIFICATION_FAILED");continue;}
    if(!stat?.isFile()||stat.isSymbolicLink()||!((await fs.readFile(entry.destination)).equals(entry.content!)))
      throw new Error("PACKAGE_MANIFEST_RESTORE_VERIFICATION_FAILED");
  }
  return entries.map(e=>e.destination);
}
function updateSnapshot(id:string,status:"committed"|"manifest_restored"|"manifest_restore_failed"|"outcome_unknown"|"environment_reconciliation_required"):void{
  updateStoredPackageSnapshot(id,status);
}

export function validatePackageName(name: string): string {
  // ":" is allowed for Maven coordinates (group:artifact:version); names are
  // always passed as argv elements (no shell), so the character class is about
  // flag injection (leading "-") and traversal (".."), not metacharacters.
  if (!/^[A-Za-z0-9@][A-Za-z0-9@._:/-]{0,213}$/.test(name) || name.includes("..")) throw new Error("Invalid package name");
  return name;
}

export function commandFor(manager: PackageManager, action: PackageAction, packageName: string): CommandSpec {
  const build = COMMANDS[manager]?.[action];
  if (!build) throw new Error(`Package manager "${manager}" does not support "${action}" via CLI (manage it declaratively instead)`);
  return build(packageName);
}

// JS-ecosystem managers share the name@version convention.
const JS_NAME_VERSION_MANAGERS: ReadonlySet<PackageManager> = new Set(["npm", "pnpm", "yarn", "bun"]);

function verificationName(manager: PackageManager, packageName: string): string {
  if (!JS_NAME_VERSION_MANAGERS.has(manager)) return packageName;
  const versionSeparator = packageName.lastIndexOf("@");
  return versionSeparator > 0 ? packageName.slice(0, versionSeparator) : packageName;
}

/**
 * Post-operation verification command per manager. Returns null when the
 * manager offers no list/query form — in that case the primary command's own
 * exit code is the verification (those commands fail loudly on any error).
 */
export function verificationCommandFor(manager: PackageManager, packageName: string): CommandSpec | null {
  const name = verificationName(manager, packageName);
  switch (manager) {
    case "npm": return { command: "npm", args: ["list", name, "--depth=0", "--json"] };
    case "pnpm": return { command: "pnpm", args: ["list", name, "--depth=0", "--json"] };
    case "yarn": return { command: "yarn", args: ["list", "--pattern", name, "--depth=0"] };
    case "bun": return { command: "bun", args: ["pm", "ls"] };
    case "pip": return { command: "python", args: ["-m", "pip", "show", packageName] };
    case "uv": return { command: "uv", args: ["pip", "show", packageName] };
    case "poetry": return { command: "poetry", args: ["show", packageName] };
    case "cargo": return { command: "cargo", args: ["install", "--list"] };
    case "dotnet": return { command: "dotnet", args: ["list", "package"] };
    case "composer": return { command: "composer", args: ["show", packageName] };
    case "bundler": return { command: "bundle", args: ["list"] };
    case "gem": return { command: "gem", args: ["list", "--exact", packageName] };
    case "winget": return { command: "winget", args: ["list", "--id", packageName, "--exact", "--accept-source-agreements"] };
    case "choco": return { command: "choco", args: ["list", "--local-only", "--exact", packageName] };
    case "brew": return { command: "brew", args: ["list", packageName] };
    case "apt": return { command: "dpkg", args: ["-s", packageName] };
    case "dnf": return { command: "rpm", args: ["-q", packageName] };
    case "pacman": return { command: "pacman", args: ["-Q", packageName] };
    case "zypper": return { command: "rpm", args: ["-q", packageName] };
    case "go":
    case "maven":
      return null;
    default:
      return null;
  }
}

export async function managePackage(input: { manager: PackageManager; action: PackageAction; name: string; cwd?: string; timeout?: number; correlationId?: string; signal?: AbortSignal }) {
  const tool = `${input.action}_package`;
  policyDecisionPoint.assertAllowed({ tool, arguments: input as unknown as Record<string, unknown>, correlationId: input.correlationId });
  if (ADMIN_MANAGERS.has(input.manager)) assertAdminPermission();
  const name = validatePackageName(input.name);
  const cwd = validateWorkspace(input.cwd ?? ".");
  // Fail fast on a non-existent cwd instead of a confusing spawn failure.
  assertCwdExists(cwd, "Package working directory");
  // Resolve the command BEFORE snapshotting so unsupported manager/action
  // combinations fail cleanly without leaving an orphan snapshot row.
  const { command, args } = commandFor(input.manager, input.action, name);
  const traceId = resolveCorrelationId(input.correlationId);
  const snapshot = await createPackageSnapshot(input.manager, input.action, name, cwd, traceId);
  let effectOutcomeKnown=false;
  try {
    const pkgExecaOpts: SpawnOptions = { cwd, shell: false, reject: false, timeout: input.timeout ?? 300000, maxBuffer: 2 * 1024 * 1024 };
    if(input.signal) pkgExecaOpts.cancelSignal=input.signal;
    const result=await spawn(command,args,pkgExecaOpts);
    effectOutcomeKnown=!result.timedOut&&!result.isCanceled;
    await logCommandAction({command,args,cwd,exitCode:result.exitCode,
      status:result.timedOut?"timeout":result.exitCode===0?"success":"failed",correlationId:traceId}).catch(()=>{});
    if(!effectOutcomeKnown)throw new Error("Package operation outcome unknown after timeout/cancellation");
    if(result.exitCode!==0)throw new Error(result.stderr||describeExecaFailure(command,result));

    const verification = verificationCommandFor(input.manager, name);
    if (!verification) {
      // No post-hoc verification exists for this manager; the primary command
      // already fails loudly on any error, so exit 0 means success.
      updateSnapshot(snapshot.id, "committed");
      return { manager: input.manager, action: input.action, name, verified: false, verificationSkipped: true, snapshotId: snapshot.id, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, correlationId: traceId };
    }
    const verifyExecaOpts: SpawnOptions = { cwd, shell: false, reject: false, timeout: Math.min(input.timeout ?? 300000, 120000), maxBuffer: 2 * 1024 * 1024 };
    if (input.signal) verifyExecaOpts.cancelSignal = input.signal;
    const checked = await spawn(verification.command, verification.args, verifyExecaOpts);
    if (checked.isCanceled) { effectOutcomeKnown=false; throw new Error(`${verification.command} verification was cancelled`); }
    if(checked.timedOut){
      effectOutcomeKnown=false;
      await logCommandAction({command:verification.command,args:verification.args,cwd,
        exitCode:checked.exitCode,status:"timeout",correlationId:traceId}).catch(()=>{});
      throw new Error("Package verification outcome unknown after timeout");
    }
    const verificationOutput = `${checked.stdout}\n${checked.stderr}`.toLowerCase();
    const explicitlyAbsent = /no installed package|not found|0 packages/.test(verificationOutput);
    const expectedName = verificationName(input.manager, name).toLowerCase();
    const comparableOutput = input.manager === "pip" ? verificationOutput.replace(/[._-]+/g, "-") : verificationOutput;
    const comparableName = input.manager === "pip" ? expectedName.replace(/[._-]+/g, "-") : expectedName;
    const present = checked.exitCode === 0 && !explicitlyAbsent && comparableOutput.includes(comparableName);
    const verified = input.action === "remove" ? !present : present;
    await logCommandAction({ command: verification.command, args: verification.args, cwd, exitCode: checked.exitCode, status: verified ? "success" : "failed", correlationId: traceId }).catch(()=>{});
    if (!verified) throw new Error(`Package ${input.action} completed but verification failed for ${name}`);
    updateSnapshot(snapshot.id, "committed");
    return { manager: input.manager, action: input.action, name, verified, snapshotId: snapshot.id, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, correlationId: traceId };
  }catch(error){
    // An interrupted package subprocess can have changed installed state.
    // Do not run automatic compensation or claim an observed final outcome.
    if(!effectOutcomeKnown){
      updateSnapshot(snapshot.id,"outcome_unknown");
      throw error;
    }
    if(snapshot.files.length===0){
      updateSnapshot(snapshot.id,"environment_reconciliation_required");
      throw error;
    }
    try{
      await restorePackageSnapshot(snapshot,cwd,input.manager);
      updateSnapshot(snapshot.id,"manifest_restored");
    }catch(restoreError){
      updateSnapshot(snapshot.id,"manifest_restore_failed");
      throw new Error(`Package operation failed; MANIFEST restoration failed. Installed environment is not restored: ${error instanceof Error?error.message:String(error)}`,{cause:restoreError});
    }
    // A verified manifest restore never proves installed packages are back.
    throw error;
  }
}

