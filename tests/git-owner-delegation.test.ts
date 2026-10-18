import { beforeEach, describe, expect, it, vi } from "vitest";
import { gitStatus, gitDiff } from "../src/services/git/git-service.js";
import { packagedOwnerWorkerPath, runOwnerWorker } from "../src/services/git/owner-worker-client.js";
import { spawn } from "../src/services/spawn.js";

vi.mock("../src/services/spawn.js", () => ({ spawn: vi.fn() }));
vi.mock("../src/services/git/owner-worker-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/git/owner-worker-client.js")>();
  return { ...actual, runOwnerWorker: vi.fn() };
});
vi.mock("../src/memory/command-audit.js", () => ({
  logCommandAction: vi.fn().mockResolvedValue(undefined),
}));
const native = vi.mocked(spawn);
const ownerWorker = vi.mocked(runOwnerWorker);

describe("cross-owner Git delegation", () => {
  beforeEach(() => { native.mockReset(); ownerWorker.mockReset(); });

  it("uses the packaged executable only next to a bundled Node runtime", () => {
    expect(packagedOwnerWorkerPath("C:\\Program Files\\HooshiX MCP\\runtime\\node.exe", "win32"))
      .toBe("C:\\Program Files\\HooshiX MCP\\bin\\hooshix-git-worker.exe");
    expect(packagedOwnerWorkerPath("C:\\Program Files\\nodejs\\node.exe", "win32")).toBeNull();
    expect(packagedOwnerWorkerPath("/usr/bin/node", "linux")).toBeNull();
  });
  it("delegates ONLY an owner-rejected Git operation", async () => {
    native.mockResolvedValueOnce({
      exitCode:128,stdout:"",stderr:"fatal: detected dubious ownership in repository",timedOut:false,
    } as Awaited<ReturnType<typeof spawn>>);
    ownerWorker.mockResolvedValueOnce({exitCode:0,stdout:"## main\\n",stderr:""});
    const result=await gitStatus(".");
    expect(result.exitCode).toBe(0);
    expect(ownerWorker).toHaveBeenCalledWith("git_status",["status","--porcelain=v1","--branch"],expect.any(String));
    expect(native).toHaveBeenCalledTimes(1);
  });
  it("fails closed when the owner worker is offline", async () => {
    native.mockResolvedValueOnce({
      exitCode:128,stdout:"",stderr:"fatal: detected dubious ownership in repository",timedOut:false,
    } as Awaited<ReturnType<typeof spawn>>);
    ownerWorker.mockResolvedValueOnce(null);
    await expect(gitStatus(".")).rejects.toThrow(/dubious ownership/i);
  });
  it("reuses the verified owner worker for git diff after dubious-ownership rev-parse", async () => {
    native.mockResolvedValueOnce({
      exitCode:128,stdout:"",stderr:"fatal: detected dubious ownership in repository",timedOut:false,
    } as Awaited<ReturnType<typeof spawn>>);
    ownerWorker
      .mockResolvedValueOnce({exitCode:0,stdout:"true\\n",stderr:""})
      .mockResolvedValueOnce({exitCode:0,stdout:"diff --git a/file b/file",stderr:""});
    const result=await gitDiff(".");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("diff --git");
    expect(ownerWorker).toHaveBeenNthCalledWith(1,"git_diff",["rev-parse","--is-inside-work-tree"],expect.any(String));
    expect(ownerWorker).toHaveBeenNthCalledWith(2,"git_diff",["diff","--"],expect.any(String));
    // Native Git would return exit 129 here instead of dubious ownership.
    expect(native).toHaveBeenCalledTimes(1);
  });
  it("preserves native Git on trusted repositories", async () => {
    native
      .mockResolvedValueOnce({exitCode:0,stdout:"true",stderr:"",timedOut:false} as Awaited<ReturnType<typeof spawn>>)
      .mockResolvedValueOnce({exitCode:0,stdout:"diff",stderr:"",timedOut:false} as Awaited<ReturnType<typeof spawn>>);
    const result=await gitDiff(".");
    expect(result.stdout).toBe("diff");
    expect(native).toHaveBeenCalledTimes(2);
    expect(ownerWorker).not.toHaveBeenCalled();
  });
  it("fails closed if the owner worker disappears between Git diff stages", async () => {
    native.mockResolvedValueOnce({
      exitCode:128,stdout:"",stderr:"fatal: detected dubious ownership in repository",timedOut:false,
    } as Awaited<ReturnType<typeof spawn>>);
    ownerWorker
      .mockResolvedValueOnce({exitCode:0,stdout:"true",stderr:""})
      .mockResolvedValueOnce(null);
    await expect(gitDiff(".")).rejects.toThrow(/owner_git_worker_unavailable_after_preflight/);
    expect(native).toHaveBeenCalledTimes(1);
  });
  it("never delegates an unrelated Git failure", async () => {
    native.mockResolvedValueOnce({
      exitCode:128,stdout:"",stderr:"fatal: not a git repository",timedOut:false,
    } as Awaited<ReturnType<typeof spawn>>);
    await expect(gitStatus(".")).rejects.toThrow(/not a git repository/);
    expect(ownerWorker).not.toHaveBeenCalled();
  });
});