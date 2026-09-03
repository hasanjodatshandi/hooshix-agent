import { describe, expect, it } from "vitest";
import { createTaskRuntimeService } from "../../src/core/runtime/composition-root.js";

describe("task runtime concurrency", () => {
  it("prevents the same task from running through two runtime instances", async () => {
    const firstRuntime = createTaskRuntimeService();
    const secondRuntime = createTaskRuntimeService();
    const plan = firstRuntime.create({
      title: "slow task",
      steps: [{ action: "slow", tool: "execute_command", arguments: { command: "node", args: ["tests/fixtures/slow-process.cjs"], timeout: 100 } }]
    });
    const first = firstRuntime.run(plan.id, 0);
    await expect(secondRuntime.run(plan.id, 0)).rejects.toThrow("already running");
    expect((await first).status).toBe("failed");
  });

  it("persists two independent tasks sharing one WAL database", async () => {
    const left = createTaskRuntimeService();
    const right = createTaskRuntimeService();
    const leftPlan = left.create({ title: "left", steps: [{ action: "read", tool: "read_file", arguments: { path: "README.md" } }] });
    const rightPlan = right.create({ title: "right", steps: [{ action: "read", tool: "read_file", arguments: { path: "package.json" } }] });
    const results = await Promise.all([left.run(leftPlan.id, 0), right.run(rightPlan.id, 0)]);
    expect(results.map((result) => result.status)).toEqual(["completed", "completed"]);
  });
});
