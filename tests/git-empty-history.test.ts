import { beforeEach, describe, expect, it, vi } from "vitest";
import { gitLog } from "../src/services/git/git-service.js";
import { spawn } from "../src/services/spawn.js";
vi.mock("../src/services/spawn.js", () => ({ spawn: vi.fn() }));
vi.mock("../src/services/git/owner-worker-client.js", () => ({ runOwnerWorker: vi.fn().mockResolvedValue(null) }));
vi.mock("../src/memory/command-audit.js", () => ({
  logCommandAction: vi.fn().mockResolvedValue(undefined),
}));
const mocked = vi.mocked(spawn);
describe("Git log on unborn, trusted repositories", () => {
  beforeEach(() => mocked.mockReset());
  it("returns an empty successful history before the first commit", async () => {
    mocked.mockResolvedValueOnce({ exitCode:128,stdout:"",stderr:"fatal: your current branch 'main' does not have any commits yet",timedOut:false } as Awaited<ReturnType<typeof spawn>>);
    await expect(gitLog(".",5)).resolves.toMatchObject({exitCode:0,stdout:"",stderr:""});
    expect(mocked).toHaveBeenCalledTimes(1);
  });
  it("does not hide ownership or missing-repository errors", async () => {
    for(const message of ["fatal: detected dubious ownership in repository at 'test'","fatal: not a git repository"]){
      mocked.mockResolvedValueOnce({exitCode:128,stdout:"",stderr:message,timedOut:false} as Awaited<ReturnType<typeof spawn>>);
      await expect(gitLog(".")).rejects.toThrow();
    }
  });
});