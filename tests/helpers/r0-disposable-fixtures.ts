/**
 * R0 disposable infrastructure fixtures. All destructive cleanup is constrained
 * to a newly created, marker-protected directory under os.tmpdir().
 * These helpers never accept an arbitrary user/repository path for deletion.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

export interface DisposableFixture {
  readonly root: string;
  readonly gitRepo: string;
  readonly sqlitePath: string;
  readonly fakePackageManager: string;
  readonly fakePackageLog: string;
  openDatabase(): Database.Database;
  initializeGit(): string;
  cleanup(): void;
}

export function createDisposableFixture(name = "test"): DisposableFixture {
  if (!/^[a-z][a-z0-9-]{0,20}$/.test(name)) throw new Error("Invalid disposable fixture label");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `hooshix-r0-${name}-`));
  const marker = path.join(root, ".hooshix-r0-marker");
  const identity = randomUUID();
  fs.writeFileSync(marker, identity, { flag: "wx" });
  const gitRepo = path.join(root, "repo");
  const sqlitePath = path.join(root, "test.sqlite");
  const fakePackageManager = path.join(root, "fake-package-manager.cjs");
  const fakePackageLog = path.join(root, "fake-package-manager.jsonl");

  // Executed ONLY through node with this fixture as cwd. It does not install
  // anything and records a serializable command/request instead.
  fs.writeFileSync(fakePackageManager,
    "const fs=require('node:fs');fs.appendFileSync(process.argv[2],JSON.stringify(process.argv.slice(3))+'\\n');\n",
    { flag: "wx" });

  return {
    root, gitRepo, sqlitePath, fakePackageManager, fakePackageLog,
    openDatabase() { return new Database(sqlitePath); },
    initializeGit() {
      if (fs.existsSync(gitRepo)) throw new Error("Fixture git repository already exists");
      const init = spawnSync("git", ["init", "--quiet", gitRepo], { encoding: "utf8" });
      if (init.status !== 0) throw new Error(`Fixture git init failed: ${init.stderr ?? init.error?.message}`);
      const identitySteps = [["config", "user.name", "R0 Fixture"], ["config", "user.email", "fixture@example.invalid"]];
      for (const args of identitySteps) {
        const result = spawnSync("git", args, { cwd: gitRepo, encoding: "utf8" });
        if (result.status !== 0) throw new Error(`Fixture git config failed: ${result.stderr}`);
      }
      return gitRepo;
    },
    cleanup() {
      // Protect against symlink/reparse redirection and deleting a directory
      // that was replaced between setup and teardown.
      if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith(`hooshix-r0-${name}-`)) {
        throw new Error("Refusing to remove a directory outside the R0 fixture namespace");
      }
      if (!fs.existsSync(marker) || fs.lstatSync(root).isSymbolicLink() ||
          fs.lstatSync(marker).isSymbolicLink() || fs.readFileSync(marker, "utf8") !== identity) {
        throw new Error("R0 fixture ownership marker has changed; refusing cleanup");
      }
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

export function createFakeClock(initialMs = Date.parse("2026-01-01T00:00:00.000Z")) {
  let current = initialMs;
  return {
    now: () => current,
    advanceBy: (milliseconds: number) => {
      if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) throw new Error("Invalid fake clock advance");
      current += milliseconds;
      return current;
    },
  };
}

/** Explicitly NOT cryptographically secure: deterministic token fixture only. */
export function createFakeTokenGenerator() {
  let n = 0;
  return () => `fixture-token-${++n}`;
}

/** Port is reserved only while returned listener is open. */
export async function reserveEphemeralLoopbackPort(): Promise<{ port: number; close(): Promise<void> }> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Loopback port reservation failed");
  return {
    port: address.port,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

/** Spawn only a dedicated fixture child; caller owns its termination. */
export function spawnDisposableNode(code: string, cwd: string): ChildProcessWithoutNullStreams {
  if (!path.isAbsolute(cwd) || !fs.existsSync(path.join(cwd, ".hooshix-r0-marker"))) {
    throw new Error("Fixture child must execute inside its dedicated marker-protected root");
  }
  return spawn(process.execPath, ["-e", code], {
    cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "" },
  });
}
