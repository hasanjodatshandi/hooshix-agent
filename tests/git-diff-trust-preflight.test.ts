import { beforeEach, describe, expect, it, vi } from "vitest";
import { gitDiff } from "../src/services/git/git-service.js";
import { spawn } from "../src/services/spawn.js";

vi.mock("../src/services/spawn.js", () => ({ spawn: vi.fn() }));
vi.mock("../src/memory/command-audit.js", () => ({
  logCommandAction: vi.fn().mockResolvedValue(undefined),
}));

const mockedSpawn = vi.mocked(spawn);

describe("git diff trust preflight", () => {
  beforeEach(() => {
    mockedSpawn.mockReset();
  });

  it("reports an untrusted Git repository without invoking the diff subcommand", async () => {
    mockedSpawn.mockResolvedValue({
      exitCode: 128,
      stdout: "",
      stderr: "fatal: detected dubious ownership in repository at 'example'",
      timedOut: false,
    } as Awaited<ReturnType<typeof spawn>>);

    await expect(gitDiff(".")).rejects.toThrow(/dubious ownership/i);
    expect(mockedSpawn).toHaveBeenCalledTimes(1);
    expect(mockedSpawn).toHaveBeenCalledWith(
      "git",
      ["rev-parse", "--is-inside-work-tree"],
      expect.objectContaining({ shell: false, reject: false }),
    );
  });

  it("continues to git diff after a successful trust preflight", async () => {
    mockedSpawn
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "true\\n",
        stderr: "",
        timedOut: false,
      } as Awaited<ReturnType<typeof spawn>>)
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "+expected\\n",
        stderr: "",
        timedOut: false,
      } as Awaited<ReturnType<typeof spawn>>);

    await expect(gitDiff(".", true)).resolves.toMatchObject({ exitCode: 0, stdout: "+expected\\n" });
    expect(mockedSpawn).toHaveBeenNthCalledWith(
      2,
      "git",
      ["diff", "--cached", "--"],
      expect.objectContaining({ shell: false }),
    );
  });
});
