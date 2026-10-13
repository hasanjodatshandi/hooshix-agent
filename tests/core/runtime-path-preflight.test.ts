import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertWritableRuntimePaths } from "../../src/infrastructure/config/runtime-path-preflight.js";
import { createDisposableFixture, type DisposableFixture } from "../helpers/r0-disposable-fixtures.js";

const initialSystemRoot = process.env.SystemRoot;
let fixture: DisposableFixture | undefined;

function useFixture(label: string): string {
  fixture = createDisposableFixture(label);
  return fixture.root;
}

afterEach(() => {
  if (initialSystemRoot === undefined) delete process.env.SystemRoot;
  else process.env.SystemRoot = initialSystemRoot;
  fixture?.cleanup();
  fixture = undefined;
});

describe("runtime path writability preflight", () => {
  it("creates and reports the absolute roots a booting host writes to", () => {
    const root = useFixture("pathsok");
    const resolved = assertWritableRuntimePaths({
      logDirectory: path.join(root, "logs"),
      databasePath: path.join(root, "data", "agent-memory.db"),
      bootstrapTokenFile: path.join(root, "secrets", ".token"),
    });

    expect(resolved).toEqual({
      logDirectory: path.join(root, "logs"),
      databaseDirectory: path.join(root, "data"),
      tokenDirectory: path.join(root, "secrets"),
    });
    for (const directory of [resolved.logDirectory, resolved.databaseDirectory, resolved.tokenDirectory]) {
      expect(fs.statSync(directory).isDirectory()).toBe(true);
    }
  });

  it("refuses a path that cannot be created and names the environment variable to fix", () => {
    const root = useFixture("pathsnafail");
    // A regular file where a parent directory is required: portable, needs no
    // privileges, and fails the same way a read-only or ACL-blocked root does.
    const blocker = path.join(root, "blocker");
    fs.writeFileSync(blocker, "");

    expect(() => assertWritableRuntimePaths({
      logDirectory: path.join(blocker, "logs"),
      databasePath: path.join(root, "a.db"),
      bootstrapTokenFile: path.join(root, ".token"),
    })).toThrowError(/log directory[\s\S]*HOOSHIX_LOG_DIR/);
  });

  it("refuses every obligation, not only the first: token and database roots are checked too", () => {
    const root = useFixture("pathseach");
    const blocker = path.join(root, "blocker");
    fs.writeFileSync(blocker, "");

    expect(() => assertWritableRuntimePaths({
      logDirectory: root,
      databasePath: path.join(blocker, "agent-memory.db"),
      bootstrapTokenFile: path.join(root, ".token"),
    })).toThrowError(/database directory[\s\S]*HOOSHIX_DB_PATH/);

    expect(() => assertWritableRuntimePaths({
      logDirectory: root,
      databasePath: path.join(root, "agent-memory.db"),
      bootstrapTokenFile: path.join(blocker, ".token"),
    })).toThrowError(/bootstrap token directory[\s\S]*HOOSHIX_BOOTSTRAP_TOKEN_FILE/);
  });

  it("rejects a root that resolves inside the Windows directory, where LocalSystem can write", () => {
    const root = useFixture("pathsysroot");
    process.env.SystemRoot = root;

    expect(() => assertWritableRuntimePaths({
      logDirectory: path.join(root, "logs"),
      databasePath: path.join(root, "data", "agent-memory.db"),
      bootstrapTokenFile: path.join(root, ".token"),
    })).toThrowError(/resolves inside the Windows directory/);
  });
});
