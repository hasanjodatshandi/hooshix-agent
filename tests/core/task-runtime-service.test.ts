import fs from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { TaskRuntimeService } from "../../src/core/runtime/task-runtime-service.js";
import { readWorkspaceFile, restoreWorkspaceFile } from "../../src/services/filesystem/filesystem-service.js";

const root = "tests/runtime-task-service";

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("persistent task runtime", () => {
  it("rejects oversized task plans before persistence", () => {
    const runtime = new TaskRuntimeService();
    expect(() => runtime.create({
      title: "oversized",
      steps: [{ action: "write", tool: "write_file", arguments: { path: `${root}/large.txt`, content: "x".repeat(8 * 1024 * 1024) } }]
    })).toThrow("8 MiB");
  });

  it("executes an explicit ChatGPT plan and reloads it after restart", async () => {
    const runtime = new TaskRuntimeService();
    const plan = runtime.create({
      title: "create and run script",
      steps: [
        { action: "create script", tool: "create_file", arguments: { path: `${root}/hello.cjs`, content: "console.log('hello-v1')" } },
        { action: "run script", tool: "execute_command", arguments: { command: "node", args: [`${root}/hello.cjs`] }, dependsOn: [1] }
      ],
      correlationId: "runtime-persistence"
    });

    const result = await runtime.run(plan.id, 0);
    expect(result.status).toBe("completed");
    expect(await readWorkspaceFile(`${root}/hello.cjs`)).toContain("hello-v1");

    const restarted = new TaskRuntimeService();
    const restored = restarted.get(plan.id)!;
    expect(restored.steps.map((step) => step.status)).toEqual(["completed", "completed"]);
    expect(JSON.stringify(restored.steps[1].output)).toContain("hello-v1");
    expect(restarted.report(plan.id).status).toBe("completed");
  });

  it("requires approval based on the delete tool and restores its backup", async () => {
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(`${root}/delete-me.txt`, "recoverable", "utf8");
    const runtime = new TaskRuntimeService();
    const plan = runtime.create({
      title: "approval enforcement",
      steps: [{ action: "harmless label", tool: "delete_file", arguments: { path: `${root}/delete-me.txt` } }]
    });

    const paused = await runtime.run(plan.id, 0);
    expect(paused.status).toBe("pending_approval");
    expect(paused.approvalId).toBeTypeOf("number");
    await expect(runtime.run(plan.id, 0)).rejects.toThrow("pending approval");
    expect(runtime.approve(paused.approvalId!)).toBe(true);
    const resumed = await runtime.resume(paused.approvalId!);
    expect(resumed.status).toBe("completed");
    await expect(readWorkspaceFile(`${root}/delete-me.txt`)).rejects.toThrow();

    const persisted = runtime.get(plan.id)!;
    const backupId = (persisted.steps[0].output as { result: { backupId: string } }).result.backupId;
    await restoreWorkspaceFile(backupId);
    expect(await readWorkspaceFile(`${root}/delete-me.txt`)).toBe("recoverable");
    await expect(runtime.resume(paused.approvalId!)).rejects.toThrow("cannot resume");
  });

  it("persists a failed command and retries it after ChatGPT fixes the cause", async () => {
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(`${root}/recover.cjs`, "process.exit(2)", "utf8");
    const runtime = new TaskRuntimeService();
    const plan = runtime.create({
      title: "retry failed step",
      steps: [{ action: "run recoverable script", tool: "execute_command", arguments: { command: "node", args: [`${root}/recover.cjs`] } }]
    });

    expect((await runtime.run(plan.id, 0)).status).toBe("failed");
    expect(runtime.get(plan.id)!.steps[0].status).toBe("failed");

    await fs.writeFile(`${root}/recover.cjs`, "console.log('recovered')", "utf8");
    expect((await runtime.run(plan.id, 0)).status).toBe("completed");
    expect(JSON.stringify(runtime.get(plan.id)!.steps[0].output)).toContain("recovered");
  });
});
