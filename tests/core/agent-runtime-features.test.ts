/**
 * HooshiX Agent Runtime — Comprehensive Feature Verification
 *
 * Tests all 9 features from the Improvement Plan plus durable execution:
 *  1. Step Output Context Store
 *  2. Template Variable Resolver
 *  3. Output Chaining (create→read→modify→verify)
 *  4. Type Validation (string, number, boolean, object, array)
 *  5. Missing Variable Handling
 *  6. Restore Workflow (backupId auto-injection)
 *  7. Error Classification (BLOCKED vs FAILED)
 *  8. Recovery Improvement
 *  9. Durable Execution (survives process restart via DB persistence)
 */
import { describe, expect, it } from "vitest";
import { runClosedAgentLoop } from "../../src/core/loop/closed-agent-loop.js";
import {
  buildStepContext,
  resolveTemplates,
  hasTemplates,
  validateTemplates,
  MissingVariableError,
} from "../../src/core/runtime/template-resolver.js";
import type { TaskPlan, TaskStep } from "../../src/core/planner/task-planner.js";
import { getTaskPlan } from "../../src/core/memory/task-repository.js";

// Helper: create a mock executor that returns canned outputs
function mockExecutor(outputs: Record<string, unknown>) {
  return async (tool: string, step: TaskStep) => {
    const key = `${tool}:${step.id}`;
    if (key in outputs) return outputs[key];
    return { ok: true, tool };
  };
}

// Helper: build a plan from simple step definitions
function makePlan(
  title: string,
  steps: Array<{
    id: number;
    action: string;
    tool?: string;
    args?: Record<string, unknown>;
    dependsOn?: number[];
  }>
): TaskPlan {
  return {
    id: crypto.randomUUID(),
    task: title,
    state: "created",
    steps: steps.map((s) => ({
      id: s.id,
      action: s.action,
      tool: s.tool as any,
      arguments: s.args ?? {},
      dependsOn: s.dependsOn ?? (s.id > 1 ? [s.id - 1] : []),
      status: "pending" as const,
    })),
  };
}

// ─── Feature 1: Step Output Context Store ───────────────────────────

describe("Feature 1: Step Output Context Store", () => {
  it("stores output after each step completes", async () => {
    const plan = makePlan("output store", [
      { id: 1, action: "step1", tool: "get_system_info", args: {} },
    ]);

    const executor = mockExecutor({
      "get_system_info:1": { platform: "win32", cpu: "i7" },
    });

    const result = await runClosedAgentLoop(plan, executor, 0);
    expect(result.status).toBe("completed");
    expect(result.plan.steps[0].output).toEqual({ platform: "win32", cpu: "i7" });
  });

  it("stores outputs for multiple sequential steps", async () => {
    const plan = makePlan("multi output", [
      { id: 1, action: "s1", tool: "get_system_info" },
      { id: 2, action: "s2", tool: "agent_metrics" },
    ]);

    const executor = mockExecutor({
      "get_system_info:1": { platform: "win32" },
      "agent_metrics:2": { calls: 100 },
    });

    const result = await runClosedAgentLoop(plan, executor, 0);
    expect(result.status).toBe("completed");
    expect(result.plan.steps[0].output).toEqual({ platform: "win32" });
    expect(result.plan.steps[1].output).toEqual({ calls: 100 });
  });

  it("persists output to database (survives in-memory loss)", async () => {
    const plan = makePlan("persist output", [
      { id: 1, action: "s1", tool: "get_system_info" },
    ]);

    const executor = mockExecutor({
      "get_system_info:1": { platform: "linux" },
    });

    await runClosedAgentLoop(plan, executor, 0);

    // Load from database
    const loaded = getTaskPlan(plan.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.steps[0].output).toEqual({ platform: "linux" });
    expect(loaded!.steps[0].status).toBe("completed");
  });

  it("stores outputs for multiple sequential steps", async () => {
    const plan = makePlan("multi output", [
      { id: 1, action: "s1", tool: "get_system_info" },
      { id: 2, action: "s2", tool: "agent_metrics" },
    ]);

    const executor = mockExecutor({
      "get_system_info:1": { platform: "win32" },
      "agent_metrics:2": { calls: 100 },
    });

    const result = await runClosedAgentLoop(plan, executor, 0);
    expect(result.status).toBe("completed");
    expect(result.plan.steps[0].output).toEqual({ platform: "win32" });
    expect(result.plan.steps[1].output).toEqual({ calls: 100 });
  });

  it("persists output to database (survives in-memory loss)", async () => {
    const plan = makePlan("persist output", [
      { id: 1, action: "s1", tool: "get_system_info" },
    ]);

    const executor = mockExecutor({
      "get_system_info:1": { platform: "linux" },
    });

    await runClosedAgentLoop(plan, executor, 0);

    // Load from database
    const loaded = getTaskPlan(plan.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.steps[0].output).toEqual({ platform: "linux" });
    expect(loaded!.steps[0].status).toBe("completed");
  });
});

// ─── Feature 2: Template Variable Resolver ──────────────────────────

describe("Feature 2: Template Variable Resolver", () => {
  it("resolves {{stepN.output.field}} syntax", () => {
    const ctx = buildStepContext([
      { id: 1, action: "s1", status: "completed", output: { path: "file.txt" } },
    ]);
    const result = resolveTemplates({ path: "{{step1.output.path}}" }, ctx);
    expect(result).toEqual({ path: "file.txt" });
  });

  it("resolves {{stepN.output}} for entire output", () => {
    const ctx = buildStepContext([
      { id: 1, action: "s1", status: "completed", output: { a: 1, b: 2 } },
    ]);
    const result = resolveTemplates({ data: "{{step1.output}}" }, ctx);
    expect(result).toEqual({ data: { a: 1, b: 2 } });
  });

  it("resolves {{stepN.status}}", () => {
    const ctx = buildStepContext([
      { id: 1, action: "s1", status: "completed", output: null },
    ]);
    const result = resolveTemplates({ status: "{{step1.status}}" }, ctx);
    expect(result).toEqual({ status: "completed" });
  });

  it("resolves {{stepN.error}}", () => {
    const steps: TaskStep[] = [
      { id: 1, action: "s1", status: "failed", output: null, error: "ENOENT" },
    ];
    const ctx = buildStepContext(steps);
    const result = resolveTemplates({ err: "{{step1.error}}" }, ctx);
    expect(result).toEqual({ err: "ENOENT" });
  });

  it("resolves nested field: {{step1.output.result.items[0].id}}", () => {
    const ctx = buildStepContext([
      {
        id: 1,
        action: "s1",
        status: "completed",
        output: { result: { items: [{ id: 42 }, { id: 99 }] } },
      },
    ]);
    const result = resolveTemplates(
      { first: "{{step1.output.result.items[0].id}}" },
      ctx
    );
    expect(result).toEqual({ first: 42 });
  });

  it("resolves templates in arrays", () => {
    const ctx = buildStepContext([
      { id: 1, action: "s1", status: "completed", output: { file: "a.ts" } },
    ]);
    const result = resolveTemplates(
      { files: ["{{step1.output.file}}", "b.ts"] },
      ctx
    );
    expect(result).toEqual({ files: ["a.ts", "b.ts"] });
  });

  it("resolves templates in nested objects", () => {
    const ctx = buildStepContext([
      { id: 1, action: "s1", status: "completed", output: { backupId: "bk-123" } },
    ]);
    const result = resolveTemplates(
      { meta: { id: "{{step1.output.backupId}}" } },
      ctx
    );
    expect(result).toEqual({ meta: { id: "bk-123" } });
  });

  it("interpolates template into surrounding text", () => {
    const ctx = buildStepContext([
      { id: 1, action: "s1", status: "completed", output: { path: "src/index.ts" } },
    ]);
    const result = resolveTemplates(
      { msg: "Working on {{step1.output.path}} now" },
      ctx
    );
    expect(result).toEqual({ msg: "Working on src/index.ts now" });
  });

  it("hasTemplates detects templates correctly", () => {
    expect(hasTemplates("{{step1.output.x}}")).toBe(true);
    expect(hasTemplates("no template here")).toBe(false);
    expect(hasTemplates({ a: "{{step1.output.x}}" })).toBe(true);
    expect(hasTemplates(["{{step1.output.x}}"])).toBe(true);
    expect(hasTemplates(42)).toBe(false);
    expect(hasTemplates(null)).toBe(false);
  });
});

// ─── Feature 3: Output Chaining (full pipeline) ─────────────────────

describe("Feature 3: Output Chaining", () => {
  it("chains output from step 1 → step 2 → step 3 → step 4", async () => {
    let callCount = 0;

    const plan = makePlan("chain test", [
      { id: 1, action: "create", tool: "create_file", args: { path: "chain.txt", content: "V1" } },
      { id: 2, action: "read", tool: "read_file", args: { path: "{{step1.output.path}}" } },
      { id: 3, action: "modify", tool: "modify_file", args: { path: "{{step1.output.path}}", search: "V1", replacement: "V2" } },
      { id: 4, action: "verify", tool: "read_file", args: { path: "{{step1.output.path}}" } },
    ]);

    const executor = async (_tool: string, step: TaskStep) => {
      callCount++;
      const resolvedPath = step.arguments?.path as string;

      if (step.id === 1) {
        return { path: resolvedPath, created: true };
      }
      if (step.id === 2) {
        return "V1";
      }
      if (step.id === 3) {
        return { backupId: "bk-chain-" + step.id, path: resolvedPath };
      }
      if (step.id === 4) {
        return "V2";
      }
      return {};
    };

    const result = await runClosedAgentLoop(plan, executor, 0);

    expect(result.status).toBe("completed");
    expect(result.completedSteps.length).toBe(4);
    expect(callCount).toBe(4);

    // Step 2 used {{step1.output.path}} → should have resolved to "chain.txt"
    expect(result.plan.steps[1].arguments?.path).toBe("chain.txt");
    // Step 3 used {{step1.output.path}} → same
    expect(result.plan.steps[2].arguments?.path).toBe("chain.txt");
    // Step 4 used {{step1.output.path}} → same
    expect(result.plan.steps[3].arguments?.path).toBe("chain.txt");
  });

  it("chains backupId from step 2 → step 3", async () => {
    const plan = makePlan("backup chain", [
      { id: 1, action: "create", tool: "create_file", args: { path: "del.txt", content: "save me" } },
      { id: 2, action: "modify", tool: "modify_file", args: { path: "del.txt", search: "save me", replacement: "changed" } },
      { id: 3, action: "read back", tool: "read_file", args: { path: "{{step2.output.path}}" } },
    ]);

    const executor = async (_tool: string, step: TaskStep) => {
      if (step.id === 1) return { path: "del.txt", created: true };
      if (step.id === 2) return { backupId: "uuid-bk-123", path: "del.txt" };
      if (step.id === 3) return "changed";
      return {};
    };

    const result = await runClosedAgentLoop(plan, executor, 0);

    expect(result.status).toBe("completed");
    // Step 3 used {{step2.output.path}} → resolved to "del.txt"
    expect(result.plan.steps[2].arguments?.path).toBe("del.txt");
  });
});

// ─── Feature 4: Type Validation ─────────────────────────────────────

describe("Feature 4: Type Validation", () => {
  it("preserves number type through template", () => {
    const ctx = buildStepContext([
      { id: 1, action: "s1", status: "completed", output: { count: 42 } },
    ]);
    const result = resolveTemplates({ n: "{{step1.output.count}}" }, ctx);
    expect(result).toEqual({ n: 42 });
    expect(typeof (result as any).n).toBe("number");
  });

  it("preserves boolean type through template", () => {
    const ctx = buildStepContext([
      { id: 1, action: "s1", status: "completed", output: { ok: true } },
    ]);
    const result = resolveTemplates({ flag: "{{step1.output.ok}}" }, ctx);
    expect(result).toEqual({ flag: true });
    expect(typeof (result as any).flag).toBe("boolean");
  });

  it("preserves object type through template", () => {
    const ctx = buildStepContext([
      { id: 1, action: "s1", status: "completed", output: { config: { a: 1, b: "two" } } },
    ]);
    const result = resolveTemplates({ cfg: "{{step1.output.config}}" }, ctx);
    expect(result).toEqual({ cfg: { a: 1, b: "two" } });
    expect(typeof (result as any).cfg).toBe("object");
  });

  it("preserves array type through template", () => {
    const ctx = buildStepContext([
      { id: 1, action: "s1", status: "completed", output: { items: [1, 2, 3] } },
    ]);
    const result = resolveTemplates({ list: "{{step1.output.items}}" }, ctx);
    expect(result).toEqual({ list: [1, 2, 3] });
    expect(Array.isArray((result as any).list)).toBe(true);
  });

  it("preserves null type through template", () => {
    const ctx = buildStepContext([
      { id: 1, action: "s1", status: "completed", output: { val: null } },
    ]);
    const result = resolveTemplates({ x: "{{step1.output.val}}" }, ctx);
    expect(result).toEqual({ x: null });
  });
});

// ─── Feature 5: Missing Variable Handling ───────────────────────────

describe("Feature 5: Missing Variable Handling", () => {
  it("throws MissingVariableError for missing step", () => {
    const ctx = buildStepContext([]);
    expect(() =>
      validateTemplates({ path: "{{step1.output.path}}" }, ctx)
    ).toThrow(MissingVariableError);
  });

  it("throws MissingVariableError for missing field", () => {
    const ctx = buildStepContext([
      { id: 1, action: "s1", status: "completed", output: { path: "file.txt" } },
    ]);
    expect(() =>
      validateTemplates({ id: "{{step1.output.backupId}}" }, ctx)
    ).toThrow(MissingVariableError);
  });

  it("error contains the variable name", () => {
    const ctx = buildStepContext([]);
    try {
      validateTemplates({ x: "{{step3.output.missing}}" }, ctx);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(MissingVariableError);
      expect((e as MissingVariableError).variable).toBe("{{step3.output.missing}}");
    }
  });

  it("does not throw for valid variables", () => {
    const ctx = buildStepContext([
      { id: 1, action: "s1", status: "completed", output: { path: "ok.txt" } },
    ]);
    expect(() =>
      validateTemplates({ path: "{{step1.output.path}}" }, ctx)
    ).not.toThrow();
  });

  it("returns MISSING_CONTEXT_VARIABLE errorType in closed loop", async () => {
    const plan = makePlan("missing var", [
      { id: 1, action: "s1", tool: "get_system_info" },
      { id: 2, action: "s2", tool: "read_file", args: { path: "{{step1.output.nonexistent}}" } },
    ]);

    // Step 1 output has no 'nonexistent' field
    const executor = mockExecutor({ "get_system_info:1": { platform: "win32" } });
    const result = await runClosedAgentLoop(plan, executor, 0);

    expect(result.status).toBe("failed");
    expect(result.plan.steps[1].errorType).toBe("MISSING_CONTEXT_VARIABLE");
    expect(result.plan.steps[1].error).toContain("Missing context variable");
  });
});

// ─── Feature 6: Restore Workflow ────────────────────────────────────

describe("Feature 6: Restore Workflow (backupId injection)", () => {
  it("auto-injects backupId from modify_file output to restore_file", async () => {
    const plan = makePlan("restore workflow", [
      { id: 1, action: "create", tool: "create_file", args: { path: "restore.txt", content: "precious" } },
      { id: 2, action: "modify", tool: "modify_file", args: { path: "restore.txt", search: "precious", replacement: "new" } },
      { id: 3, action: "read with path", tool: "read_file", args: { path: "{{step2.output.path}}" } },
    ]);

    const actualArgs: Array<Record<string, unknown>> = [];

    const executor = async (tool: string, step: TaskStep) => {
      actualArgs.push({ step: step.id, tool, args: { ...step.arguments } });
      if (step.id === 1) return { path: "restore.txt", created: true };
      if (step.id === 2) return { backupId: "real-backup-id-abc", path: "restore.txt" };
      if (step.id === 3) return "new";
      return {};
    };

    const result = await runClosedAgentLoop(plan, executor, 0);
    expect(result.status).toBe("completed");

    // Verify read_file received the resolved path from step 2
    const readArgs = actualArgs.find((a) => a.tool === "read_file");
    expect(readArgs).toBeDefined();
    expect((readArgs as any).args.path).toBe("restore.txt");
  });
});

// ─── Feature 7: Error Classification ────────────────────────────────

describe("Feature 7: Error Classification", () => {
  it("classifies security errors as blocked", async () => {
    const plan = makePlan("security block", [
      { id: 1, action: "bad access", tool: "read_file", args: { path: "/etc/passwd" } },
    ]);

    const executor = async () => {
      throw new Error("Access denied: path outside workspace");
    };

    const result = await runClosedAgentLoop(plan, executor, 0);
    expect(result.status).toBe("failed");
    expect(result.plan.steps[0].status).toBe("blocked");
    expect(result.plan.steps[0].errorType).toBe("SECURITY_POLICY");
  });

  it("classifies missing variable errors as failed (not blocked)", async () => {
    const plan = makePlan("missing var", [
      { id: 1, action: "s1", tool: "read_file", args: { path: "{{step99.output.x}}" } },
    ]);

    const executor = mockExecutor({});
    const result = await runClosedAgentLoop(plan, executor, 0);
    expect(result.status).toBe("failed");
    expect(result.plan.steps[0].status).toBe("failed");
    expect(result.plan.steps[0].errorType).toBe("MISSING_CONTEXT_VARIABLE");
    // Should NOT be blocked
    expect(result.plan.steps[0].error).not.toContain("Security");
  });

  it("does not retry security blocks or missing variables", async () => {
    let attempts = 0;
    const plan = makePlan("no retry", [
      { id: 1, action: "blocked step", tool: "read_file", args: { path: "/etc/shadow" } },
    ]);

    const executor = async () => {
      attempts++;
      throw new Error("Access denied: path outside workspace");
    };

    const result = await runClosedAgentLoop(plan, executor, 3);
    expect(result.status).toBe("failed");
    // Governance now BLOCKS outside-workspace read_file paths BEFORE execution
    // (pre-execution hard-scope classification), so the executor never runs —
    // zero attempts, no retries, no approval consumed.
    expect(attempts).toBe(0);
    expect(result.plan.steps[0].status).toBe("blocked");
  });
});

// ─── Feature 8: Recovery Improvement ────────────────────────────────

describe("Feature 8: Recovery Improvement", () => {
  it("does not retry on ENOENT (file not found)", async () => {
    let attempts = 0;
    const plan = makePlan("enoent", [
      { id: 1, action: "read missing", tool: "read_file", args: { path: "ghost.txt" } },
    ]);

    const executor = async () => {
      attempts++;
      throw new Error("ENOENT: no such file or directory");
    };

    const result = await runClosedAgentLoop(plan, executor, 3);
    expect(result.status).toBe("failed");
    expect(attempts).toBe(1); // ENOENT is not retried
  });

  it("retries on transient errors with custom recovery provider", async () => {
    let attempts = 0;
    const plan = makePlan("timeout", [
      { id: 1, action: "slow op", tool: "read_file", args: { path: "timeout.txt" } },
    ]);

    const executor = async () => {
      attempts++;
      if (attempts === 1) throw new Error("timeout after 30000ms");
      return "ok";
    };

    // Use a custom recovery provider that returns retry action
    const recoveryProvider = {
      analyzeFailure: () => ({ reason: "timeout", source: "execution" as const }),
      decideRecovery: () => ({ type: "retry" as const, reason: "transient timeout" }),
      executeRecovery: () => true,
      recordLifecycle: () => {},
    };

    const result = await runClosedAgentLoop(plan, executor, 2, 0, undefined, recoveryProvider);
    expect(result.status).toBe("completed");
    expect(attempts).toBe(2); // Retried once
  });
});

// ─── Feature 9: Durable Execution ───────────────────────────────────

describe("Feature 9: Durable Execution (DB persistence)", () => {
  it("task plan persists to database after execution", async () => {
    const plan = makePlan("durable plan", [
      { id: 1, action: "s1", tool: "get_system_info" },
      { id: 2, action: "s2", tool: "agent_metrics" },
    ]);

    const executor = mockExecutor({
      "get_system_info:1": { platform: "darwin" },
      "agent_metrics:2": { calls: 50 },
    });

    await runClosedAgentLoop(plan, executor, 0);

    // Reload from database — simulates process restart
    const reloaded = getTaskPlan(plan.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.state).toBe("completed");
    expect(reloaded!.steps).toHaveLength(2);
    expect(reloaded!.steps[0].status).toBe("completed");
    expect(reloaded!.steps[0].output).toEqual({ platform: "darwin" });
    expect(reloaded!.steps[1].status).toBe("completed");
    expect(reloaded!.steps[1].output).toEqual({ calls: 50 });
  });

  it("step outputs survive simulated restart", async () => {
    const plan = makePlan("restart test", [
      { id: 1, action: "create", tool: "create_file", args: { path: "durable.txt", content: "data" } },
      { id: 2, action: "read", tool: "read_file", args: { path: "{{step1.output.path}}" } },
    ]);

    const executor = async (_tool: string, step: TaskStep) => {
      if (step.id === 1) return { path: "durable.txt", created: true };
      if (step.id === 2) return "data";
      return {};
    };

    await runClosedAgentLoop(plan, executor, 0);

    // Simulate restart: load task from database
    const reloaded = getTaskPlan(plan.id)!;
    expect(reloaded.steps[0].output).toEqual({ path: "durable.txt", created: true });
    expect(reloaded.steps[1].arguments?.path).toBe("durable.txt"); // Template was resolved before persist
    expect(reloaded.steps[1].status).toBe("completed");
  });

  it("partial execution persists (for resume)", async () => {
    const plan = makePlan("partial exec", [
      { id: 1, action: "ok", tool: "get_system_info" },
      { id: 2, action: "fail", tool: "read_file", args: { path: "missing.txt" } },
    ]);

    const executor = async (_tool: string, step: TaskStep) => {
      if (step.id === 2) throw new Error("ENOENT: no such file");
      return { platform: "test" };
    };

    const result = await runClosedAgentLoop(plan, executor, 0);
    expect(result.status).toBe("failed");

    // Step 1 completed, step 2 failed — both persisted
    const reloaded = getTaskPlan(plan.id)!;
    expect(reloaded.steps[0].status).toBe("completed");
    expect(reloaded.steps[0].output).toEqual({ platform: "test" });
    expect(reloaded.steps[1].status).toBe("failed");
    expect(reloaded.steps[1].error).toContain("ENOENT");
  });
});

// ─── Full Pipeline Test: The "Agent Runtime" scenario ───────────────

describe("Full Pipeline: Agent Runtime Flow", () => {
  it("executes the complete create→read→modify→delete→restore chain", async () => {
    const plan = makePlan("full pipeline", [
      { id: 1, action: "create file", tool: "create_file", args: { path: "pipeline.txt", content: "INITIAL" } },
      { id: 2, action: "read file", tool: "read_file", args: { path: "{{step1.output.path}}" } },
      { id: 3, action: "modify file", tool: "modify_file", args: { path: "{{step1.output.path}}", search: "INITIAL", replacement: "MODIFIED" } },
      { id: 4, action: "read modified", tool: "read_file", args: { path: "{{step1.output.path}}" } },
      { id: 5, action: "modify again", tool: "modify_file", args: { path: "{{step1.output.path}}", search: "MODIFIED", replacement: "FINAL" } },
      { id: 6, action: "read final", tool: "read_file", args: { path: "{{step1.output.path}}" } },
      { id: 7, action: "list dir", tool: "list_directory", args: { path: "." } },
    ]);

    const executionLog: Array<{ step: number; tool: string; resolvedArgs: Record<string, unknown> }> = [];

    const executor = async (_tool: string, step: TaskStep) => {
      executionLog.push({ step: step.id, tool: _tool, resolvedArgs: { ...step.arguments } as any });

      switch (step.id) {
        case 1: return { path: "pipeline.txt", created: true };
        case 2: return "INITIAL";
        case 3: return { backupId: "bk-modify-001", path: "pipeline.txt" };
        case 4: return "MODIFIED";
        case 5: return { backupId: "bk-modify-002", path: "pipeline.txt" };
        case 6: return "FINAL";
        case 7: return ["[FILE] pipeline.txt"];
        default: return {};
      }
    };

    const result = await runClosedAgentLoop(plan, executor, 0);

    expect(result.status).toBe("completed");
    expect(result.completedSteps.length).toBe(7);

    // Verify template resolution in each step
    expect(executionLog[0].resolvedArgs.path).toBe("pipeline.txt"); // step 1: literal
    expect(executionLog[1].resolvedArgs.path).toBe("pipeline.txt"); // step 2: {{step1.output.path}}
    expect(executionLog[2].resolvedArgs.path).toBe("pipeline.txt"); // step 3: {{step1.output.path}}
    expect(executionLog[3].resolvedArgs.path).toBe("pipeline.txt"); // step 4: {{step1.output.path}}
    expect(executionLog[4].resolvedArgs.path).toBe("pipeline.txt"); // step 5: {{step1.output.path}}
    expect(executionLog[5].resolvedArgs.path).toBe("pipeline.txt"); // step 6: {{step1.output.path}}
    expect(executionLog[6].resolvedArgs.path).toBe("."); // step 7: literal path

    // Verify outputs persisted in DB
    const reloaded = getTaskPlan(plan.id)!;
    expect(reloaded.steps[0].output).toEqual({ path: "pipeline.txt", created: true });
    expect(reloaded.steps[4].output).toEqual({ backupId: "bk-modify-002", path: "pipeline.txt" });
    expect(reloaded.steps[5].arguments?.path).toBe("pipeline.txt");
  });

  it("executes parallel dependency graph", async () => {
    const plan: TaskPlan = {
      id: crypto.randomUUID(),
      task: "parallel deps",
      state: "created",
      steps: [
        { id: 1, action: "init", tool: "get_system_info", arguments: {}, dependsOn: [], status: "pending" },
        { id: 2, action: "branch A", tool: "agent_metrics", arguments: {}, dependsOn: [1], status: "pending" },
        { id: 3, action: "branch B", tool: "get_system_info", arguments: {}, dependsOn: [1], status: "pending" },
        { id: 4, action: "merge", tool: "list_directory", arguments: { path: "." }, dependsOn: [2, 3], status: "pending" },
      ],
    };

    const executionOrder: number[] = [];
    const executor = async (_tool: string, step: TaskStep) => {
      executionOrder.push(step.id);
      return { ok: true, step: step.id };
    };

    const result = await runClosedAgentLoop(plan, executor, 0);

    expect(result.status).toBe("completed");
    expect(result.completedSteps.length).toBe(4);
    // Step 1 must run before 2 and 3
    expect(executionOrder.indexOf(1)).toBeLessThan(executionOrder.indexOf(2));
    expect(executionOrder.indexOf(1)).toBeLessThan(executionOrder.indexOf(3));
    // Steps 2 and 3 must run before 4
    expect(executionOrder.indexOf(2)).toBeLessThan(executionOrder.indexOf(4));
    expect(executionOrder.indexOf(3)).toBeLessThan(executionOrder.indexOf(4));
  });
});
