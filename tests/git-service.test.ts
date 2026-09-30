import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execa } from "execa";
import { gitBranch, gitCheckout, gitCommit, gitDiff, gitLog, gitStatus } from "../src/services/git/git-service.js";
import { runWithPolicyApproval } from "../src/core/governance/policy-decision-point.js";

const repository = "tests/runtime-git";

beforeEach(async () => {
  await fs.rm(repository, { recursive: true, force: true });
  await fs.mkdir(repository, { recursive: true });
  await execa("git", ["init"], { cwd: repository });
  await execa("git", ["config", "user.email", "hooshix-test@example.invalid"], { cwd: repository });
  await execa("git", ["config", "user.name", "HooshiX Test"], { cwd: repository });
});

afterEach(async () => {
  await fs.rm(repository, { recursive: true, force: true });
});

describe("Git service", () => {
  it("reports status and diff, commits, creates a branch, and switches to it", async () => {
    await fs.writeFile(`${repository}/sample.txt`, "one\n", "utf8");
    await execa("git", ["add", "sample.txt"], { cwd: repository });
    expect((await runWithPolicyApproval("git_commit", () => gitCommit(repository, "initial", "git-service-test"))).exitCode).toBe(0);

    await fs.writeFile(`${repository}/sample.txt`, "two\n", "utf8");
    expect((await gitStatus(repository)).stdout).toContain("sample.txt");
    expect((await gitDiff(repository)).stdout).toContain("+two");

    await runWithPolicyApproval("git_branch", () => gitBranch(repository, "feature/test"));
    await runWithPolicyApproval("git_checkout", () => gitCheckout(repository, "feature/test"));
    expect((await gitStatus(repository)).stdout).toContain("feature/test");
  });

  it("rejects unsafe refs and paths outside the workspace", async () => {
    expect(() => gitBranch(repository, "../escape")).toThrow("Invalid Git ref");
    await expect(gitStatus("../outside-workspace")).rejects.toThrow("outside workspace");
  });

  it("clamps and neutralizes the git log limit against argv injection", async () => {
    // Seed three commits so a bounded log is distinguishable from an unbounded one.
    for (const i of [1, 2, 3]) {
      await fs.writeFile(`${repository}/f${i}.txt`, `${i}\n`, "utf8");
      await execa("git", ["add", `f${i}.txt`], { cwd: repository });
      await execa("git", ["commit", "-m", `c${i}`], { cwd: repository });
    }

    // A numeric limit is honored.
    expect((await gitLog(repository, 2)).stdout.trim().split("\n")).toHaveLength(2);

    // A non-numeric or hostile limit cannot smuggle extra argv through the
    // `--max-count=${limit}` template: it falls back to the default, never to
    // an injected flag, and no side-effect file is created.
    const hostile = "1; touch tests/runtime-pwned";
    const result = await gitLog(repository, hostile as unknown as number);
    expect(result.stdout).toContain("c3");
    await expect(fs.access("tests/runtime-pwned")).rejects.toThrow();

    // An out-of-range limit is clamped into the documented 1-100 window.
    expect((await gitLog(repository, 9999)).stdout.trim().split("\n")).toHaveLength(3);
  });
});
