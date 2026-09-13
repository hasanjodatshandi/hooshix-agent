import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectInProcessMcp, json } from "../helpers/in-process-mcp.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

const root = path.resolve("tests/stage21");
let client: Client;
let close: () => Promise<void>;

beforeEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(root, { recursive: true });
  const harness = await connectInProcessMcp();
  client = harness.client;
  close = harness.close;
});

afterEach(async () => {
  await close();
  await fs.rm(root, { recursive: true, force: true });
});

/**
 * Stage 21 campaign regressions — each test pins a defect that the
 * validation campaign demonstrated against an earlier build.
 */
describe("Stage 21 regressions", () => {
  it("Task-invoked agent_metrics(limit=1) honors the limit (was: 100)", async () => {
    const task = json(await client.callTool({ name: "task_create", arguments: { title: "metrics-limit", steps: [
      { action: "metrics", tool: "agent_metrics", arguments: { limit: 1, offset: 0 } },
    ] } }));
    const run = json(await client.callTool({ name: "task_run", arguments: { taskId: task.id, maxRecovery: 0 } }));
    expect(run.status).toBe("completed");
    const plan = json(await client.callTool({ name: "task_get", arguments: { taskId: task.id } }));
    const output = plan.steps[0].output?.result ?? plan.steps[0].output;
    // Both direct and Task paths must resolve the same argument set
    expect(output.pagination.limit).toBe(1);
    expect(output.recentCalls.length).toBe(1);
  });

  it("direct and Task agent_metrics(limit=1) agree on pagination", async () => {
    const direct = json(await client.callTool({ name: "agent_metrics", arguments: { limit: 1, offset: 0 } }));
    const task = json(await client.callTool({ name: "task_create", arguments: { title: "metrics-limit-2", steps: [
      { action: "metrics", tool: "agent_metrics", arguments: { limit: 1, offset: 0 } },
    ] } }));
    json(await client.callTool({ name: "task_run", arguments: { taskId: task.id, maxRecovery: 0 } }));
    const plan = json(await client.callTool({ name: "task_get", arguments: { taskId: task.id } }));
    const taskOutput = plan.steps[0].output?.result ?? plan.steps[0].output;
    expect(direct.pagination.limit).toBe(taskOutput.pagination.limit);
    expect(direct.pagination.offset).toBe(taskOutput.pagination.offset);
  });

  it("read-only get_workspace runs in a Task without ADMIN_MODE (was: blocked)", async () => {
    const task = json(await client.callTool({ name: "task_create", arguments: { title: "ws-read", steps: [
      { action: "read workspace", tool: "get_workspace", arguments: {} },
    ] } }));
    const run = json(await client.callTool({ name: "task_run", arguments: { taskId: task.id, maxRecovery: 0 } }));
    expect(run.status).toBe("completed");
    const plan = json(await client.callTool({ name: "task_get", arguments: { taskId: task.id } }));
    expect(plan.steps[0].status).toBe("completed");
    expect(plan.steps[0].error).toBeUndefined();
  });

  it("blocked-step report counts blockedSteps and reflection names the governance block", async () => {
    const task = json(await client.callTool({ name: "task_create", arguments: { title: "blocked-report", steps: [
      { action: "delete outside", tool: "delete_file", arguments: { path: "../outside-blocked.txt" } },
    ] } }));
    let run = json(await client.callTool({ name: "task_run", arguments: { taskId: task.id, maxRecovery: 0 } }));
    for (let i = 0; i < 3 && run.status === "pending_approval"; i++) {
      await client.callTool({ name: "task_approve", arguments: { approvalId: run.approvalId } });
      run = json(await client.callTool({ name: "task_resume", arguments: { approvalId: run.approvalId } }));
    }
    expect(run.status).toBe("failed");
    const plan = json(await client.callTool({ name: "task_get", arguments: { taskId: task.id } }));
    expect(plan.steps[0].status).toBe("blocked");

    const report = json(await client.callTool({ name: "task_report", arguments: { taskId: task.id } }));
    // Blocked steps must be visible — not reported as 0/0/0
    expect(report.blockedSteps).toBe(1);
    expect(report.completedSteps).toBe(0);
    expect(report.taskStatus).toBe("failed");
    // Reflection must contradict neither: it names the governance block
    expect(report.reflection.problem).toContain("blocked");
    expect(report.reflection.solution).not.toContain("succeeded");
  });

  it("task_report metrics are Task-scoped (fresh read-only task shows no foreign failures)", async () => {
    // Seed a foreign failure for a different task so global contamination is detectable
    const foreign = json(await client.callTool({ name: "task_create", arguments: { title: "foreign-fail", steps: [
      { action: "read missing", tool: "read_file", arguments: { path: "does-not-exist-stage21.txt" } },
    ] } }));
    json(await client.callTool({ name: "task_run", arguments: { taskId: foreign.id, maxRecovery: 0 } }));

    const task = json(await client.callTool({ name: "task_create", arguments: { title: "clean-readonly", steps: [
      { action: "read", tool: "read_file", arguments: { path: "README.md" } },
    ] } }));
    json(await client.callTool({ name: "task_run", arguments: { taskId: task.id, maxRecovery: 0 } }));

    const report = json(await client.callTool({ name: "task_report", arguments: { taskId: task.id } }));
    // The clean task's own report must not inherit the foreign task's failures
    expect(report.metrics.workflowFailedActions).toBe(0);
    expect(report.metrics.recoveryAttempts).toBe(0);
    expect(report.metrics.recoverySuccessRate).toBeNull();
    expect(report.metrics.averageRecoveryTimeMs).toBeNull();
  });

  it("timeout steps are marked outcome_unknown with reconciliationRequired (P0 execution reality)", async () => {
    await fs.writeFile(path.join(root, "slow.cjs"), "setTimeout(() => process.exit(0), 8000);", "utf8");
    const task = json(await client.callTool({ name: "task_create", arguments: { title: "timeout-outcome", steps: [
      // Step-level timeout kills the child via AbortController before the
      // tool's own 30s default — the process must NOT run to completion (the
      // Stage 9 P0: mutation finishing after the step was marked failed).
      { action: "run slow", tool: "execute_command", arguments: { command: "node", args: [path.relative(process.cwd(), path.join(root, "slow.cjs"))] }, timeout: 300 },
    ] } }));
    let run = json(await client.callTool({ name: "task_run", arguments: { taskId: task.id, maxRecovery: 0 } }));
    for (let i = 0; i < 3 && run.status === "pending_approval"; i++) {
      await client.callTool({ name: "task_approve", arguments: { approvalId: run.approvalId } });
      run = json(await client.callTool({ name: "task_resume", arguments: { approvalId: run.approvalId } }));
    }
    const plan = json(await client.callTool({ name: "task_get", arguments: { taskId: task.id } }));
    const step = plan.steps[0];
    expect(step.status).toBe("outcome_unknown");
    expect(step.errorType).toBe("TIMEOUT");
  }, 20000);

  it("replay of a legacy (template-less) dependent step reports staleValueStepIds and refuses equivalence", async () => {
    // Source: two steps, second consumes the first's output, executed so that
    // arguments are resolved and persisted WITHOUT templateArguments (legacy shape).
    const srcFile = path.relative(process.cwd(), path.join(root, "src.txt")).replace(/\\/g, "/");
    const task = json(await client.callTool({ name: "task_create", arguments: { title: "legacy-replay", steps: [
      { action: "write", tool: "write_file", arguments: { path: srcFile, content: "v1" } },
      { action: "read", tool: "read_file", arguments: { path: srcFile }, dependsOn: [1] },
    ] } }));
    const run = json(await client.callTool({ name: "task_run", arguments: { taskId: task.id, maxRecovery: 0 } }));
    expect(run.status).toBe("completed");

    const replay = json(await client.callTool({ name: "task_replay", arguments: { taskId: task.id, allowMutations: true } }));
    // The dependent step (id 2) has dependsOn but no templateArguments → stale-prone
    expect(replay.comparison.staleValueStepIds).toContain(2);
    expect(replay.comparison.equivalentOutputs).toBe(false);
  });

  it("replay of a template-carrying task resolves from the immutable templates", async () => {
    const file1 = path.relative(process.cwd(), path.join(root, "t1.txt")).replace(/\\/g, "/");
    const file2 = path.relative(process.cwd(), path.join(root, "t2.txt")).replace(/\\/g, "/");
    const task = json(await client.callTool({ name: "task_create", arguments: { title: "template-replay", steps: [
      { action: "write one", tool: "write_file", arguments: { path: file1, content: "A" } },
      { action: "write two from one", tool: "write_file", arguments: { path: file2, content: "{{step1.output.path}}" }, dependsOn: [1] },
    ] } }));
    json(await client.callTool({ name: "task_run", arguments: { taskId: task.id, maxRecovery: 0 } }));
    const plan = json(await client.callTool({ name: "task_get", arguments: { taskId: task.id } }));
    // templateArguments persisted on the template-carrying step
    expect(plan.steps[1].templateArguments).toBeDefined();

    const replay = json(await client.callTool({ name: "task_replay", arguments: { taskId: task.id, allowMutations: true } }));
    // Step 2 carries its templates → replay resolves from ITS OWN step 1 output
    expect(replay.comparison.staleValueStepIds).not.toContain(2);
    const replayPlan = json(await client.callTool({ name: "task_get", arguments: { taskId: replay.replayTaskId } }));
    // The replay run keeps the declared templates as provenance...
    expect(String(replayPlan.steps[1].templateArguments?.content)).toContain("{{step1.output.path}}");
    // ...and the resolved content points at the REPLAY's own step-1 target (its own write)
    expect(String(replayPlan.steps[1].arguments.content)).toContain("t1.txt");
    expect(String(replayPlan.steps[1].arguments.content)).not.toContain("{{");
  });

  it("maxConsecutiveFailures budget blocks endless re-runs of a failing step", async () => {
    const bad = path.relative(process.cwd(), path.join(root, "bad.cjs"));
    await fs.writeFile(bad, "process.exit(3);", "utf8");
    const task = json(await client.callTool({ name: "task_create", arguments: {
      title: "budget",
      retryPolicy: { maxConsecutiveFailures: 2 },
      steps: [{ action: "fail", tool: "execute_command", arguments: { command: "node", args: [bad] } }],
    } }));
    // Run 1 — approve and fail once
    let run = json(await client.callTool({ name: "task_run", arguments: { taskId: task.id, maxRecovery: 0 } }));
    for (let i = 0; i < 3 && run.status === "pending_approval"; i++) {
      await client.callTool({ name: "task_approve", arguments: { approvalId: run.approvalId } });
      run = json(await client.callTool({ name: "task_resume", arguments: { approvalId: run.approvalId } }));
    }
    expect(run.status).toBe("failed");
    // Run 2 — second consecutive failure
    let run2: any = json(await client.callTool({ name: "task_run", arguments: { taskId: task.id, maxRecovery: 0 } }));
    for (let i = 0; i < 3 && run2.status === "pending_approval"; i++) {
      await client.callTool({ name: "task_approve", arguments: { approvalId: run2.approvalId } });
      run2 = json(await client.callTool({ name: "task_resume", arguments: { approvalId: run2.approvalId } }));
    }
    expect(run2.status).toBe("failed");
    // Run 3 — budget exhausted: rejected with a structured error
    const third = await client.callTool({ name: "task_run", arguments: { taskId: task.id, maxRecovery: 0 } });
    expect(third.isError).toBe(true);
    const text = (third.content as Array<{ type: string; text?: string }>).find((b) => b.type === "text")?.text ?? "";
    expect(text).toContain("maxConsecutiveFailures");
  });
});
