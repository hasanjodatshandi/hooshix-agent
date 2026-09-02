import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { execaMock } = vi.hoisted(() => ({
  execaMock: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "cloned", stderr: "", timedOut: false })
}));
vi.mock("execa", () => ({ execa: execaMock }));

import { gitClone } from "../src/services/git/git-service.js";

const target = "tests/runtime-git-clone/repository";

afterEach(async () => {
  execaMock.mockClear();
  await fs.rm(path.dirname(target), { recursive: true, force: true });
});

describe("Git clone boundary", () => {
  it("passes a credential-free HTTPS URL as an argument without a shell", async () => {
    const result = await gitClone("https://example.com/owner/repository.git", target, "clone-test");
    expect(result.exitCode).toBe(0);
    expect(execaMock).toHaveBeenCalledOnce();
    const [command, args, options] = execaMock.mock.calls[0];
    expect(command).toBe("git");
    expect(args).toEqual(["clone", "--", "https://example.com/owner/repository.git", path.resolve(target)]);
    expect(options.shell).toBe(false);
  });

  it("rejects embedded credentials, non-HTTPS transports, and existing targets", async () => {
    await expect(gitClone("https://user:secret@example.com/repository.git", target)).rejects.toThrow("credential-free HTTPS");
    await expect(gitClone("file:///outside/repository", target)).rejects.toThrow("credential-free HTTPS");
    await fs.mkdir(target, { recursive: true });
    await expect(gitClone("https://example.com/repository.git", target)).rejects.toThrow("already exists");
    expect(execaMock).not.toHaveBeenCalled();
  });
});
