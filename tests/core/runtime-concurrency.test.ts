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
    // node <script> is approval-gated — the first run pauses for approval
    expect((await first).status).toBe("pending_approval");
    // While paused (not running) a second runtime may pick the task up,
    // but two simultaneous runs of the same task are still rejected.
    await expect(secondRuntime.run(plan.id, 0)).rejects.toThrow("pending approval");
  });

  it("persists two independent tasks sharing one WAL database", async () => {
    const left = createTaskRuntimeService();
    const right = createTaskRuntimeService();
    const leftPlan = left.create({ title: "left", steps: [{ action: "read", tool: "read_file", arguments: { path: "README.md" } }] });
    const rightPlan = right.create({ title: "right", steps: [{ action: "read", tool: "read_file", arguments: { path: "package.json" } }] });
    const results = await Promise.all([left.run(leftPlan.id, 0), right.run(rightPlan.id, 0)]);
    expect(results.map((result) => result.status)).toEqual(["completed", "completed"]);
  });

  it("rejects two simultaneous runs of the same read-only task", async () => {
    const runtime = createTaskRuntimeService();
    const plan = runtime.create({
      title: "concurrent",
      steps: [{ action: "read", tool: "read_file", arguments: { path: "README.md" } }]
    });
    const first = runtime.run(plan.id, 0);
    await expect(runtime.run(plan.id, 0)).rejects.toThrow("already running");
    expect((await first).status).toBe("completed");
  });
});
