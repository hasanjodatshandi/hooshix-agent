import { beforeEach, describe, expect, it, vi } from "vitest";
import { inspectGitReadiness } from "../src/services/git/git-readiness.js";
import { spawn } from "../src/services/spawn.js";

vi.mock("../src/services/spawn.js", () => ({ spawn: vi.fn() }));
const mockedSpawn = vi.mocked(spawn);

describe("onboarding Git trust status", () => {
  beforeEach(() => mockedSpawn.mockReset());

  it("reports ready only for a trusted worktree", async () => {
    mockedSpawn.mockResolvedValue({
      exitCode: 0, stdout: "true\n", stderr: "", timedOut: false,
    } as Awaited<ReturnType<typeof spawn>>);
    await expect(inspectGitReadiness("C:\\repo")).resolves.toEqual({ status: "ready" });
    expect(mockedSpawn).toHaveBeenCalledWith(
      "git", ["rev-parse", "--is-inside-work-tree"],
      expect.objectContaining({ cwd: "C:\\repo", shell: false, reject: false, timeout: 5000 }),
    );
  });

  it("warns about cross-owner repositories without trusting them or exposing stderr", async () => {
    const sensitive = "C:\\Users\\Somebody\\private";
    mockedSpawn.mockResolvedValue({
      exitCode: 128, stdout: "",
      stderr: "fatal: detected dubious ownership in repository at " + sensitive,
      timedOut: false,
    } as Awaited<ReturnType<typeof spawn>>);
    const result = await inspectGitReadiness(sensitive);
    expect(result.status).toBe("untrusted_owner");
    expect(JSON.stringify(result)).not.toContain(sensitive);
    expect(mockedSpawn).toHaveBeenCalledTimes(1);
    expect(mockedSpawn.mock.calls[0]?.[1]).not.toContain("-c");
  });

  it("does not require Git for a non-repository workspace", async () => {
    mockedSpawn.mockResolvedValue({
      exitCode: 128, stdout: "", stderr: "fatal: not a git repository",
      timedOut: false,
    } as Awaited<ReturnType<typeof spawn>>);
    await expect(inspectGitReadiness("C:\\plain")).resolves.toEqual({ status: "not_repository" });
  });

  it("keeps ordinary file access available when Git is missing", async () => {
    mockedSpawn.mockImplementationOnce(() => { throw new Error("ENOENT"); });
    const result = await inspectGitReadiness("C:\\plain");
    expect(result.status).toBe("unavailable");
    expect(JSON.stringify(result)).not.toContain("ENOENT");
  });
});