import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDisposableFixture, createFakeClock, createFakeTokenGenerator,
  reserveEphemeralLoopbackPort, spawnDisposableNode,
  type DisposableFixture,
} from "../helpers/r0-disposable-fixtures.js";

let fixture: DisposableFixture | undefined;
afterEach(() => {
  fixture?.cleanup();
  fixture = undefined;
});

describe("R0 disposable fixture safety", () => {
  it("creates an isolated workspace under OS temp and removes only its owned marker-protected data", () => {
    fixture = createDisposableFixture("workspace");
    const other = fs.mkdtempSync(path.join(fixture.root, "child-"));
    fs.writeFileSync(path.join(other, "marker.txt"), "fixture-only");
    expect(fs.readFileSync(path.join(other, "marker.txt"), "utf8")).toBe("fixture-only");
    expect(fs.existsSync(path.join(fixture.root, ".hooshix-r0-marker"))).toBe(true);
  });

  it("refuses to clean a directory whose marker has been modified", () => {
    fixture = createDisposableFixture("guard");
    const marker = path.join(fixture.root, ".hooshix-r0-marker");
    const originalIdentity = fs.readFileSync(marker, "utf8");
    fs.writeFileSync(marker, "tampered");
    expect(() => fixture!.cleanup()).toThrow(/marker has changed/);
    fs.writeFileSync(marker, originalIdentity); // allow the normal guarded afterEach cleanup
  });

  it("builds an isolated SQLite database and closes it before cleanup", () => {
    fixture = createDisposableFixture("db");
    const db = fixture.openDatabase();
    try {
      db.exec("CREATE TABLE sample (n INTEGER NOT NULL)");
      db.prepare("INSERT INTO sample(n) VALUES (?)").run(7);
      expect(db.prepare("SELECT n FROM sample").get()).toEqual({ n: 7 });
    } finally { db.close(); }
  });

  it("initializes Git with a local fixture-only identity", () => {
    fixture = createDisposableFixture("git");
    const repo = fixture.initializeGit();
    const status = spawnSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" });
    expect(status.status).toBe(0);
    expect(status.stdout.trim()).toBe("");
    const name = spawnSync("git", ["config", "user.name"], { cwd: repo, encoding: "utf8" });
    expect(name.stdout.trim()).toBe("R0 Fixture");
  });

  it("records fake package-manager calls without installing a package", () => {
    fixture = createDisposableFixture("package");
    const result = spawnSync(process.execPath,
      [fixture.fakePackageManager, fixture.fakePackageLog, "install", "example"],
      { cwd: fixture.root, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(fs.readFileSync(fixture.fakePackageLog, "utf8").trim()).toBe('["install","example"]');
  });

  it("uses deterministic, explicitly non-cryptographic clock and tokens", () => {
    const clock = createFakeClock(1000);
    expect(clock.advanceBy(250)).toBe(1250);
    expect(clock.now()).toBe(1250);
    expect(() => clock.advanceBy(-1)).toThrow();
    const token = createFakeTokenGenerator();
    expect([token(), token()]).toEqual(["fixture-token-1", "fixture-token-2"]);
  });

  it("reserves an ephemeral loopback port and releases it explicitly", async () => {
    const reservation = await reserveEphemeralLoopbackPort();
    expect(reservation.port).toBeGreaterThan(0);
    await reservation.close();
  });

  it("runs and terminates only a child process spawned inside a fixture root", async () => {
    fixture = createDisposableFixture("child");
    expect(() => spawnDisposableNode("process.exit()", process.cwd())).toThrow(/marker-protected/);
    const child = spawnDisposableNode("process.stdout.write('READY\\n');setInterval(()=>{},1000)", fixture.root);
    try {
      const ready = await new Promise<string>((resolve, reject) => {
        child.once("error", reject);
        child.stdout.once("data", (chunk: Buffer) => resolve(chunk.toString("utf8")));
      });
      expect(ready).toContain("READY");
    } finally {
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      child.kill();
      await exited;
    }
  });
});
